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
import { defaultWorkspace, groupsDirectory, groupSource } from '../paths.ts';

export interface GroupRepo {
  path: string;
  name: string;
}

export interface Group {
  name: string;
  source: string;
  workspace: string;
  repos: GroupRepo[];
  backends: Record<string, { settings?: Record<string, unknown> }>;
}

export interface GroupFile {
  name?: string | undefined;
  workspace?: string | undefined;
  repos?: { path: string; name?: string | undefined }[] | undefined;
  backends?: Group['backends'] | undefined;
}

export const GROUP_FILE = 'group.json';
export const INSTRUCTIONS_FILE = 'CLAUDE.md';
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
  return join(groupSource(name, env), GROUP_FILE);
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
    source: groupSource(name, env),
    workspace: resolve(expandHome(file.workspace ?? defaultWorkspace(name, env), env)),
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
  const source = groupSource(name, env);
  const workspace = defaultWorkspace(name, env);
  mkdirSync(source, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  writeGroupFile(name, { name, workspace, repos, backends: {} }, env);
  const instructions = join(source, INSTRUCTIONS_FILE);
  if (!existsSync(instructions)) writeFileSync(instructions, '');
  return loadGroup(name, env);
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

// The workspace stays where it is: Claude Code files transcripts by cwd.
export function renameGroup(from: string, to: string, env?: NodeJS.ProcessEnv): Group {
  const file = readGroupFile(from, env);
  requireGroupName(to);
  if (existsSync(groupSource(to, env)))
    throw new CarnetError('GROUP_EXISTS', `Group ${to} already exists`);
  const workspace = loadGroup(from, env).workspace;
  renameSync(groupSource(from, env), groupSource(to, env));
  writeGroupFile(to, { ...file, name: to, workspace }, env);
  return loadGroup(to, env);
}

export interface DropGroupOptions {
  purge?: boolean | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

export function dropGroup(name: string, options: DropGroupOptions = {}): Group {
  const group = loadGroup(name, options.env);
  rmSync(group.source, { recursive: true, force: true });
  if (options.purge) rmSync(group.workspace, { recursive: true, force: true });
  return group;
}
