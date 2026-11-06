import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { CarnetError } from '../errors.ts';
import { DEFAULT_HOST } from '../hosts/host.ts';
import { defaultRunDirectory, workspacesDirectory, workspaceDefinition } from '../paths.ts';

export interface WorkspaceRepo {
  path: string;
  name: string;
}

export interface Workspace {
  name: string;
  definition: string;
  runDirectory: string;
  repos: WorkspaceRepo[];
  backends: Record<string, { settings?: Record<string, unknown> }>;
}

export interface WorkspaceFile {
  name?: string | undefined;
  repos?: { path: string; name?: string | undefined }[] | undefined;
  backends?: Workspace['backends'] | undefined;
}

export const WORKSPACE_FILE = 'workspace.json';
export const INSTRUCTIONS_FILE = 'CLAUDE.md';
export const AGENTS_FILE = 'AGENTS.md';
const WORKSPACE_NAME = /^[a-z0-9-]+$/;

export function isWorkspaceName(name: string): boolean {
  return WORKSPACE_NAME.test(name);
}

function requireWorkspaceName(name: string): void {
  if (!isWorkspaceName(name)) {
    throw new CarnetError(
      'WORKSPACE_NAME_INVALID',
      `Invalid workspace name ${JSON.stringify(name)}: use lowercase letters, digits and dashes`,
    );
  }
}

export function expandHome(path: string, env: NodeJS.ProcessEnv = process.env): string {
  if (path !== '~' && !path.startsWith('~/')) return path;
  return join(env.HOME || homedir(), path.slice(1));
}

function workspaceFilePath(name: string, env?: NodeJS.ProcessEnv): string {
  return join(workspaceDefinition(name, env), WORKSPACE_FILE);
}

export function workspaceExists(name: string, env?: NodeJS.ProcessEnv): boolean {
  return isWorkspaceName(name) && existsSync(workspaceFilePath(name, env));
}

function readWorkspaceFile(name: string, env?: NodeJS.ProcessEnv): WorkspaceFile {
  if (!workspaceExists(name, env)) {
    throw new CarnetError(
      'WORKSPACE_NOT_FOUND',
      `No workspace named ${name}: see "rucher ws list"`,
    );
  }
  return JSON.parse(readFileSync(workspaceFilePath(name, env), 'utf8')) as WorkspaceFile;
}

function writeWorkspaceFile(name: string, file: WorkspaceFile, env?: NodeJS.ProcessEnv): void {
  writeFileSync(workspaceFilePath(name, env), `${JSON.stringify(file, null, 2)}\n`);
}

export function loadWorkspace(name: string, env: NodeJS.ProcessEnv = process.env): Workspace {
  const file = readWorkspaceFile(name, env);
  return {
    name,
    definition: workspaceDefinition(name, env),
    runDirectory: defaultRunDirectory(name, env),
    repos: (file.repos ?? []).map((repo) => {
      const path = resolve(expandHome(repo.path, env));
      return { path, name: repo.name ?? basename(path) };
    }),
    backends: file.backends ?? {},
  };
}

export function listWorkspaces(env: NodeJS.ProcessEnv = process.env): Workspace[] {
  const directory = workspacesDirectory(env);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => workspaceExists(name, env))
    .sort()
    .map((name) => loadWorkspace(name, env));
}

export function workspaceHosts(workspace: Workspace): string[] {
  const hosts = Object.keys(workspace.backends);
  return hosts.length ? hosts : [DEFAULT_HOST];
}

function checkedRepo(path: string, env?: NodeJS.ProcessEnv): string {
  const absolute = resolve(expandHome(path, env));
  if (!existsSync(absolute))
    throw new CarnetError('REPO_NOT_FOUND', `Repo path does not exist: ${absolute}`);
  return absolute;
}

// Notes reference repos by name, so two repos cannot share one.
function requireDistinctNames(workspace: string, repos: readonly WorkspaceRepo[]): void {
  const names = repos.map((repo) => repo.name);
  const shared = names.find((name, index) => names.indexOf(name) !== index);
  if (shared) {
    throw new CarnetError(
      'REPO_NAME_TAKEN',
      `${workspace} would have two repos named ${shared}: give them distinct names`,
    );
  }
}

export interface CreateWorkspaceOptions {
  repos?: readonly string[] | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

export function createWorkspace(name: string, options: CreateWorkspaceOptions = {}): Workspace {
  const { env } = options;
  requireWorkspaceName(name);
  if (workspaceExists(name, env))
    throw new CarnetError('WORKSPACE_EXISTS', `Workspace ${name} already exists`);
  const paths = [...new Set((options.repos ?? []).map((repo) => checkedRepo(repo, env)))];
  const repos = paths.map((path) => ({ path, name: basename(path) }));
  requireDistinctNames(name, repos);
  const definition = workspaceDefinition(name, env);
  const runDirectory = defaultRunDirectory(name, env);
  mkdirSync(definition, { recursive: true });
  mkdirSync(runDirectory, { recursive: true });
  writeWorkspaceFile(name, { name, repos, backends: {} }, env);
  const instructions = join(definition, INSTRUCTIONS_FILE);
  if (!existsSync(instructions)) writeFileSync(instructions, '');
  return loadWorkspace(name, env);
}

export function definitionInstructions(workspace: Workspace): string {
  const agents = existsSync(join(workspace.definition, AGENTS_FILE));
  if (agents && existsSync(join(workspace.definition, INSTRUCTIONS_FILE))) {
    throw new CarnetError(
      'WORKSPACE_INSTRUCTIONS_CONFLICT',
      `Workspace ${workspace.name} has both ${AGENTS_FILE} and ${INSTRUCTIONS_FILE} in ${workspace.definition}: remove ${INSTRUCTIONS_FILE}`,
    );
  }
  return agents ? AGENTS_FILE : INSTRUCTIONS_FILE;
}

export function addWorkspaceRepo(name: string, repo: string, env?: NodeJS.ProcessEnv): Workspace {
  const file = readWorkspaceFile(name, env);
  const workspace = loadWorkspace(name, env);
  const path = checkedRepo(repo, env);
  if (workspace.repos.some((existing) => existing.path === path)) return workspace;
  requireDistinctNames(name, [...workspace.repos, { path, name: basename(path) }]);
  writeWorkspaceFile(
    name,
    { ...file, repos: [...(file.repos ?? []), { path, name: basename(path) }] },
    env,
  );
  return loadWorkspace(name, env);
}

export function removeWorkspaceRepo(
  name: string,
  repo: string,
  env?: NodeJS.ProcessEnv,
): Workspace {
  const file = readWorkspaceFile(name, env);
  const workspace = loadWorkspace(name, env);
  const path = resolve(expandHome(repo, env));
  const index = workspace.repos.findIndex(
    (existing) => existing.path === path || existing.name === repo,
  );
  if (index === -1) throw new CarnetError('REPO_NOT_FOUND', `${repo} is not a repo of ${name}`);
  writeWorkspaceFile(
    name,
    { ...file, repos: (file.repos ?? []).filter((_, position) => position !== index) },
    env,
  );
  return loadWorkspace(name, env);
}

export interface DropWorkspaceOptions {
  purge?: boolean | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

export function dropWorkspace(name: string, options: DropWorkspaceOptions = {}): Workspace {
  const workspace = loadWorkspace(name, options.env);
  rmSync(workspace.definition, { recursive: true, force: true });
  if (options.purge) rmSync(workspace.runDirectory, { recursive: true, force: true });
  return workspace;
}
