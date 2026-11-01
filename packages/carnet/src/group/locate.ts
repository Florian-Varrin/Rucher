import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { CarnetError } from '../errors.ts';
import { allHosts, DEFAULT_HOST } from '../hosts/host.ts';
import { readRegistry } from './registry.ts';

export const GROUP_DIRECTORY = '.rucher';
export const REPORTS_DIRECTORY = 'reports';
export const GROUP_FILE = 'group.json';
export const DB_FILE = 'carnet.db';

export interface Group {
  root: string;
  name: string;
  repos: string[];
  hosts: string[];
  dbPath: string;
}

export interface GroupFile {
  name: string;
  repos: string[];
  hosts?: string[] | undefined;
}

export function isInside(directory: string, path: string): boolean {
  const relativePath = relative(directory, path);
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !resolve(relativePath).startsWith(relativePath))
  );
}

export function repoNameFor(group: Group, path: string | undefined): string | null {
  if (!path) return null;
  const repo = group.repos.find((repo) => isInside(repo, resolve(path)));
  return repo ? basename(repo) : null;
}

export function repoPathFor(group: Group, path: string | undefined | null): string | null {
  if (!path) return null;
  const absolutePath = resolve(path);
  const repo = group.repos.find((candidate) => isInside(candidate, absolutePath));
  if (!repo) return null;
  const relativePath = relative(repo, absolutePath);
  return relativePath ? join(basename(repo), relativePath) : basename(repo);
}

export function findGroupRoot(from: string): string | null {
  let directory = resolve(from);
  for (;;) {
    // The registry home is also named .rucher, only group.json marks a group.
    if (isGroupRoot(directory)) return directory;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

export function reportsDirectoryOf(group: Group): string {
  return join(group.root, GROUP_DIRECTORY, REPORTS_DIRECTORY);
}

export function reportPathFor(group: Group, agentName: string): string {
  return join(reportsDirectoryOf(group), `${agentName}.md`);
}

export function isGroupRoot(directory: string): boolean {
  return existsSync(join(directory, GROUP_DIRECTORY, GROUP_FILE));
}

export function loadGroup(root: string): Group {
  const file = JSON.parse(
    readFileSync(join(root, GROUP_DIRECTORY, GROUP_FILE), 'utf8'),
  ) as GroupFile;
  return {
    root,
    name: file.name,
    repos: (file.repos ?? []).map((repo) => resolve(root, repo)),
    hosts: file.hosts?.length ? file.hosts : [DEFAULT_HOST],
    dbPath: join(root, GROUP_DIRECTORY, DB_FILE),
  };
}

export interface LocateOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

function groupByRepo(path: string, env?: NodeJS.ProcessEnv): Group | null {
  for (const reference of readRegistry(env)) {
    if (!isGroupRoot(reference.path)) continue;
    const group = loadGroup(reference.path);
    if (group.repos.some((repo) => isInside(repo, path))) return group;
  }
  return null;
}

export function locateGroup({ cwd = process.cwd(), env = process.env }: LocateOptions = {}): Group {
  const projectDirectories = allHosts()
    .map((host) => host.projectDirectory(env))
    .filter((directory): directory is string => directory !== undefined);
  const candidates = [resolve(cwd), ...projectDirectories.map((directory) => resolve(directory))];
  for (const directory of candidates) {
    const root = findGroupRoot(directory);
    if (root) return loadGroup(root);
  }
  for (const directory of candidates) {
    const group = groupByRepo(directory, env);
    if (group) return group;
  }
  throw new CarnetError(
    'NO_GROUP',
    `No Rucher group for ${cwd}: run "rucher init" in a meta directory, or "rucher group add <this repo>" there`,
  );
}
