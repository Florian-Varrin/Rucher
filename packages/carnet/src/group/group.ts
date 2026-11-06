import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { CarnetError } from '../errors.ts';
import { DEFAULT_HOST } from '../hosts/host.ts';
import { defaultRunDirectory, groupsDirectory, groupDefinition } from '../paths.ts';

export interface GroupRepo {
  path: string;
  name: string;
}

export interface Group {
  name: string;
  definition: string;
  runDirectory: string;
  repos: GroupRepo[];
  backends: Record<string, { settings?: Record<string, unknown> }>;
}

export interface GroupFile {
  name?: string | undefined;
  // Existing group files hold the run directory under this key.
  workspace?: string | undefined;
  repos?: { path: string; name?: string | undefined }[] | undefined;
  backends?: Group['backends'] | undefined;
}

export const GROUP_FILE = 'group.json';
export const INSTRUCTIONS_FILE = 'CLAUDE.md';
export const AGENTS_FILE = 'AGENTS.md';
const GROUP_NAME = /^[a-z0-9-]+$/;

export function isGroupName(name: string): boolean {
  return GROUP_NAME.test(name);
}

function requireGroupName(name: string): void {
  if (!isGroupName(name)) {
    throw new CarnetError(
      'GROUP_NAME_INVALID',
      `Invalid group name ${JSON.stringify(name)}: use lowercase letters, digits and dashes`,
    );
  }
}

export function expandHome(path: string, env: NodeJS.ProcessEnv = process.env): string {
  if (path !== '~' && !path.startsWith('~/')) return path;
  return join(env.HOME || homedir(), path.slice(1));
}

function groupFilePath(name: string, env?: NodeJS.ProcessEnv): string {
  return join(groupDefinition(name, env), GROUP_FILE);
}

export function groupExists(name: string, env?: NodeJS.ProcessEnv): boolean {
  return isGroupName(name) && existsSync(groupFilePath(name, env));
}

function readGroupFile(name: string, env?: NodeJS.ProcessEnv): GroupFile {
  if (!groupExists(name, env)) {
    throw new CarnetError('GROUP_NOT_FOUND', `No group named ${name}: see "rucher groups list"`);
  }
  return JSON.parse(readFileSync(groupFilePath(name, env), 'utf8')) as GroupFile;
}

function writeGroupFile(name: string, file: GroupFile, env?: NodeJS.ProcessEnv): void {
  writeFileSync(groupFilePath(name, env), `${JSON.stringify(file, null, 2)}\n`);
}

export function loadGroup(name: string, env: NodeJS.ProcessEnv = process.env): Group {
  const file = readGroupFile(name, env);
  return {
    name,
    definition: groupDefinition(name, env),
    runDirectory: resolve(expandHome(file.workspace ?? defaultRunDirectory(name, env), env)),
    repos: (file.repos ?? []).map((repo) => {
      const path = resolve(expandHome(repo.path, env));
      return { path, name: repo.name ?? basename(path) };
    }),
    backends: file.backends ?? {},
  };
}

export function listGroups(env: NodeJS.ProcessEnv = process.env): Group[] {
  const directory = groupsDirectory(env);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => groupExists(name, env))
    .sort()
    .map((name) => loadGroup(name, env));
}

export function groupHosts(group: Group): string[] {
  const hosts = Object.keys(group.backends);
  return hosts.length ? hosts : [DEFAULT_HOST];
}

function checkedRepo(path: string, env?: NodeJS.ProcessEnv): string {
  const absolute = resolve(expandHome(path, env));
  if (!existsSync(absolute))
    throw new CarnetError('REPO_NOT_FOUND', `Repo path does not exist: ${absolute}`);
  return absolute;
}

// Notes reference repos by name, so two repos cannot share one.
function requireDistinctNames(group: string, repos: readonly GroupRepo[]): void {
  const names = repos.map((repo) => repo.name);
  const shared = names.find((name, index) => names.indexOf(name) !== index);
  if (shared) {
    throw new CarnetError(
      'REPO_NAME_TAKEN',
      `${group} would have two repos named ${shared}: give them distinct names`,
    );
  }
}

export interface CreateGroupOptions {
  repos?: readonly string[] | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

export function createGroup(name: string, options: CreateGroupOptions = {}): Group {
  const { env } = options;
  requireGroupName(name);
  if (groupExists(name, env)) throw new CarnetError('GROUP_EXISTS', `Group ${name} already exists`);
  const paths = [...new Set((options.repos ?? []).map((repo) => checkedRepo(repo, env)))];
  const repos = paths.map((path) => ({ path, name: basename(path) }));
  requireDistinctNames(name, repos);
  const definition = groupDefinition(name, env);
  const runDirectory = defaultRunDirectory(name, env);
  mkdirSync(definition, { recursive: true });
  mkdirSync(runDirectory, { recursive: true });
  writeGroupFile(name, { name, workspace: runDirectory, repos, backends: {} }, env);
  const instructions = join(definition, INSTRUCTIONS_FILE);
  if (!existsSync(instructions)) writeFileSync(instructions, '');
  return loadGroup(name, env);
}

export function definitionInstructions(group: Group): string {
  const agents = existsSync(join(group.definition, AGENTS_FILE));
  if (agents && existsSync(join(group.definition, INSTRUCTIONS_FILE))) {
    throw new CarnetError(
      'GROUP_INSTRUCTIONS_CONFLICT',
      `Group ${group.name} has both ${AGENTS_FILE} and ${INSTRUCTIONS_FILE} in ${group.definition}: remove ${INSTRUCTIONS_FILE}`,
    );
  }
  return agents ? AGENTS_FILE : INSTRUCTIONS_FILE;
}

export function addGroupRepo(name: string, repo: string, env?: NodeJS.ProcessEnv): Group {
  const file = readGroupFile(name, env);
  const group = loadGroup(name, env);
  const path = checkedRepo(repo, env);
  if (group.repos.some((existing) => existing.path === path)) return group;
  requireDistinctNames(name, [...group.repos, { path, name: basename(path) }]);
  writeGroupFile(
    name,
    { ...file, repos: [...(file.repos ?? []), { path, name: basename(path) }] },
    env,
  );
  return loadGroup(name, env);
}

export function removeGroupRepo(name: string, repo: string, env?: NodeJS.ProcessEnv): Group {
  const file = readGroupFile(name, env);
  const group = loadGroup(name, env);
  const path = resolve(expandHome(repo, env));
  const index = group.repos.findIndex(
    (existing) => existing.path === path || existing.name === repo,
  );
  if (index === -1) throw new CarnetError('REPO_NOT_FOUND', `${repo} is not a repo of ${name}`);
  writeGroupFile(
    name,
    { ...file, repos: (file.repos ?? []).filter((_, position) => position !== index) },
    env,
  );
  return loadGroup(name, env);
}

// The run directory stays where it is: Claude Code files transcripts by cwd.
export function renameGroup(from: string, to: string, env?: NodeJS.ProcessEnv): Group {
  const file = readGroupFile(from, env);
  requireGroupName(to);
  if (existsSync(groupDefinition(to, env)))
    throw new CarnetError('GROUP_EXISTS', `Group ${to} already exists`);
  const workspace = loadGroup(from, env).runDirectory;
  renameSync(groupDefinition(from, env), groupDefinition(to, env));
  writeGroupFile(to, { ...file, name: to, workspace }, env);
  return loadGroup(to, env);
}

export interface DropGroupOptions {
  purge?: boolean | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

export function dropGroup(name: string, options: DropGroupOptions = {}): Group {
  const group = loadGroup(name, options.env);
  rmSync(group.definition, { recursive: true, force: true });
  if (options.purge) rmSync(group.runDirectory, { recursive: true, force: true });
  return group;
}
