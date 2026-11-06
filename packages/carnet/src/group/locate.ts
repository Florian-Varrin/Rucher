import type { DatabaseSync } from 'node:sqlite';
import { join, relative, resolve } from 'node:path';
import { CarnetError } from '../errors.ts';
import { allHosts } from '../hosts/host.ts';
import { sessionGroupName } from '../group-rows.ts';
import { type Group, type GroupRepo, groupExists, listGroups, loadGroup } from './group.ts';

export type { Group, GroupRepo } from './group.ts';

export function isInside(directory: string, path: string): boolean {
  const relativePath = relative(directory, path);
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !resolve(relativePath).startsWith(relativePath))
  );
}

function repoOf(group: Group | null, path: string): GroupRepo | undefined {
  const absolutePath = resolve(path);
  return group?.repos.find((repo) => isInside(repo.path, absolutePath));
}

export function repoNameFor(group: Group | null, path: string | undefined): string | null {
  return path ? (repoOf(group, path)?.name ?? null) : null;
}

export function repoPathFor(group: Group | null, path: string | undefined | null): string | null {
  if (!path) return null;
  const repo = repoOf(group, path);
  if (!repo) return null;
  const relativePath = relative(repo.path, resolve(path));
  return relativePath ? join(repo.name, relativePath) : repo.name;
}

export type GroupOrigin = 'session' | 'option' | 'env' | 'run-directory' | 'repo' | 'none';

export interface GroupResolution {
  group: Group | null;
  origin: GroupOrigin;
  repo?: GroupRepo | undefined;
}

export interface ResolveGroupOptions {
  db?: DatabaseSync | undefined;
  sessionId?: string | undefined;
  group?: string | undefined;
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

function namedGroup(name: string, env: NodeJS.ProcessEnv): Group {
  if (!groupExists(name, env)) {
    throw new CarnetError('GROUP_NOT_FOUND', `No group named ${name}: see "rucher groups list"`);
  }
  return loadGroup(name, env);
}

function byRunDirectory(
  groups: readonly Group[],
  directories: readonly string[],
): Group | undefined {
  return groups.find((group) =>
    directories.some((directory) => isInside(group.runDirectory, directory)),
  );
}

function byRepo(
  groups: readonly Group[],
  directory: string,
): { group: Group; repo: GroupRepo } | undefined {
  let best: { group: Group; repo: GroupRepo }[] = [];
  for (const group of groups) {
    for (const repo of group.repos) {
      if (!isInside(repo.path, directory)) continue;
      const length = best[0]?.repo.path.length ?? -1;
      if (repo.path.length > length) best = [{ group, repo }];
      else if (repo.path.length === length) best.push({ group, repo });
    }
  }
  const names = [...new Set(best.map((match) => match.group.name))];
  if (names.length > 1) {
    throw new CarnetError(
      'GROUP_AMBIGUOUS',
      `${directory} is in repos of several groups (${names.join(', ')}): pass --group`,
    );
  }
  return best[0];
}

export function resolveGroup({
  db,
  sessionId,
  group,
  cwd = process.cwd(),
  env = process.env,
}: ResolveGroupOptions = {}): GroupResolution {
  if (db && sessionId) {
    const name = sessionGroupName(db, sessionId);
    if (name === null) return { group: null, origin: 'session' };
    if (name !== undefined && groupExists(name, env)) {
      return { group: loadGroup(name, env), origin: 'session' };
    }
  }
  if (group) return { group: namedGroup(group, env), origin: 'option' };
  if (env.RUCHER_GROUP) return { group: namedGroup(env.RUCHER_GROUP, env), origin: 'env' };
  const projectDirectories = allHosts()
    .map((host) => host.projectDirectory(env))
    .filter((directory): directory is string => directory !== undefined);
  const directories = [resolve(cwd), ...projectDirectories.map((directory) => resolve(directory))];
  const groups = listGroups(env);
  const runDirectoryGroup = byRunDirectory(groups, directories);
  if (runDirectoryGroup) return { group: runDirectoryGroup, origin: 'run-directory' };
  for (const directory of directories) {
    const match = byRepo(groups, directory);
    if (match) return { group: match.group, origin: 'repo', repo: match.repo };
  }
  return { group: null, origin: 'none' };
}

export function groupLabel(group: Group | null): string {
  return group?.name ?? 'no group';
}

export function requireGroup(group: Group | null): Group {
  if (group) return group;
  throw new CarnetError(
    'NO_GROUP',
    'No Rucher group here: pass --group, or run this from a repo or run directory of a group',
  );
}

export function ambiguousGroupContext(reason: string): string {
  return `Rucher could not tell which group this session belongs to, so Carnet records nothing for it: ${reason}.`;
}
