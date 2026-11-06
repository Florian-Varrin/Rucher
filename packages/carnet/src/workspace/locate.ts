import type { DatabaseSync } from 'node:sqlite';
import { join, relative, resolve } from 'node:path';
import { CarnetError } from '../errors.ts';
import { allHosts } from '../hosts/host.ts';
import { sessionWorkspaceName } from '../workspace-rows.ts';
import {
  type Workspace,
  type WorkspaceRepo,
  workspaceExists,
  listWorkspaces,
  loadWorkspace,
} from './workspace.ts';

export type { Workspace, WorkspaceRepo } from './workspace.ts';

export function isInside(directory: string, path: string): boolean {
  const relativePath = relative(directory, path);
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !resolve(relativePath).startsWith(relativePath))
  );
}

function repoOf(workspace: Workspace | null, path: string): WorkspaceRepo | undefined {
  const absolutePath = resolve(path);
  return workspace?.repos.find((repo) => isInside(repo.path, absolutePath));
}

export function repoNameFor(workspace: Workspace | null, path: string | undefined): string | null {
  return path ? (repoOf(workspace, path)?.name ?? null) : null;
}

export function repoPathFor(
  workspace: Workspace | null,
  path: string | undefined | null,
): string | null {
  if (!path) return null;
  const repo = repoOf(workspace, path);
  if (!repo) return null;
  const relativePath = relative(repo.path, resolve(path));
  return relativePath ? join(repo.name, relativePath) : repo.name;
}

export type WorkspaceOrigin = 'session' | 'option' | 'env' | 'run-directory' | 'repo' | 'none';

export interface WorkspaceResolution {
  workspace: Workspace | null;
  origin: WorkspaceOrigin;
  repo?: WorkspaceRepo | undefined;
}

export interface ResolveWorkspaceOptions {
  db?: DatabaseSync | undefined;
  sessionId?: string | undefined;
  workspace?: string | undefined;
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

function namedWorkspace(name: string, env: NodeJS.ProcessEnv): Workspace {
  if (!workspaceExists(name, env)) {
    throw new CarnetError(
      'WORKSPACE_NOT_FOUND',
      `No workspace named ${name}: see "rucher ws list"`,
    );
  }
  return loadWorkspace(name, env);
}

function byRunDirectory(
  workspaces: readonly Workspace[],
  directories: readonly string[],
): Workspace | undefined {
  return workspaces.find((workspace) =>
    directories.some((directory) => isInside(workspace.runDirectory, directory)),
  );
}

function byRepo(
  workspaces: readonly Workspace[],
  directory: string,
): { workspace: Workspace; repo: WorkspaceRepo } | undefined {
  let best: { workspace: Workspace; repo: WorkspaceRepo }[] = [];
  for (const workspace of workspaces) {
    for (const repo of workspace.repos) {
      if (!isInside(repo.path, directory)) continue;
      const length = best[0]?.repo.path.length ?? -1;
      if (repo.path.length > length) best = [{ workspace, repo }];
      else if (repo.path.length === length) best.push({ workspace, repo });
    }
  }
  const names = [...new Set(best.map((match) => match.workspace.name))];
  if (names.length > 1) {
    throw new CarnetError(
      'WORKSPACE_AMBIGUOUS',
      `${directory} is in repos of several workspaces (${names.join(', ')}): pass --ws`,
    );
  }
  return best[0];
}

export function resolveWorkspace({
  db,
  sessionId,
  workspace,
  cwd = process.cwd(),
  env = process.env,
}: ResolveWorkspaceOptions = {}): WorkspaceResolution {
  if (db && sessionId) {
    const name = sessionWorkspaceName(db, sessionId);
    if (name === null) return { workspace: null, origin: 'session' };
    if (name !== undefined && workspaceExists(name, env)) {
      return { workspace: loadWorkspace(name, env), origin: 'session' };
    }
  }
  if (workspace) return { workspace: namedWorkspace(workspace, env), origin: 'option' };
  if (env.RUCHER_WS) return { workspace: namedWorkspace(env.RUCHER_WS, env), origin: 'env' };
  const projectDirectories = allHosts()
    .map((host) => host.projectDirectory(env))
    .filter((directory): directory is string => directory !== undefined);
  const directories = [resolve(cwd), ...projectDirectories.map((directory) => resolve(directory))];
  const workspaces = listWorkspaces(env);
  const runDirectoryWorkspace = byRunDirectory(workspaces, directories);
  if (runDirectoryWorkspace) return { workspace: runDirectoryWorkspace, origin: 'run-directory' };
  for (const directory of directories) {
    const match = byRepo(workspaces, directory);
    if (match) return { workspace: match.workspace, origin: 'repo', repo: match.repo };
  }
  return { workspace: null, origin: 'none' };
}

export function workspaceLabel(workspace: Workspace | null): string {
  return workspace?.name ?? 'no workspace';
}

export function requireWorkspace(workspace: Workspace | null): Workspace {
  if (workspace) return workspace;
  throw new CarnetError(
    'NO_WORKSPACE',
    'No Rucher workspace here: pass --ws, or run this from a repo or run directory of a workspace',
  );
}

export function ambiguousWorkspaceContext(reason: string): string {
  return `Rucher could not tell which workspace this session belongs to, so Carnet records nothing for it: ${reason}.`;
}
