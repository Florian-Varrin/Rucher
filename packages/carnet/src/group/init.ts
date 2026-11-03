import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { CarnetError } from '../errors.ts';
import { openDatabase } from '../db/open.ts';
import { DEFAULT_HOST, hostById } from '../hosts/host.ts';
import {
  DB_FILE,
  GROUP_DIRECTORY,
  GROUP_FILE,
  REPORTS_DIRECTORY,
  type Group,
  type GroupFile,
  loadGroup,
} from './locate.ts';
import { registerGroup } from './registry.ts';

export interface InitOptions {
  name?: string | undefined;
  repos?: string[] | undefined;
  hosts?: string[] | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

function writeGroupFile(root: string, file: GroupFile): void {
  writeFileSync(join(root, GROUP_DIRECTORY, GROUP_FILE), `${JSON.stringify(file, null, 2)}\n`);
}

function resolveRepo(root: string, repo: string): string {
  const path = resolve(root, repo);
  if (!existsSync(path))
    throw new CarnetError('REPO_NOT_FOUND', `Repo path does not exist: ${path}`);
  return path;
}

export function initGroup(directory: string, options: InitOptions = {}): Group {
  const root = resolve(directory);
  const groupDirectory = join(root, GROUP_DIRECTORY);
  if (existsSync(groupDirectory)) {
    throw new CarnetError('GROUP_EXISTS', `${root} is already a Rucher group`);
  }
  const name = options.name ?? basename(root);
  const repos = [...new Set((options.repos ?? []).map((repo) => resolveRepo(root, repo)))];
  const names = repos.map((repo) => basename(repo));
  const shared = names.find((repoName, index) => names.indexOf(repoName) !== index);
  if (shared) {
    throw new CarnetError(
      'REPO_NAME_TAKEN',
      `Two repos are named ${shared}: give them distinct names`,
    );
  }
  const hosts = (options.hosts?.length ? options.hosts : [DEFAULT_HOST]).map(
    (id) => hostById(id).id,
  );
  mkdirSync(join(groupDirectory, REPORTS_DIRECTORY), { recursive: true });
  writeGroupFile(root, { name, repos, hosts });
  openDatabase(join(groupDirectory, DB_FILE)).close();
  registerGroup({ name, path: root }, options.env);
  return loadGroup(root);
}

export function addGroupRepo(root: string, repo: string): Group {
  const group = loadGroup(resolve(root));
  const path = resolveRepo(group.root, repo);
  const sameName = group.repos.find(
    (existing) => existing !== path && basename(existing) === basename(path),
  );
  // Notes reference repos by name, so two repos cannot share one.
  if (sameName) {
    throw new CarnetError(
      'REPO_NAME_TAKEN',
      `${group.name} already has a repo named ${basename(path)}: ${sameName}`,
    );
  }
  if (!group.repos.includes(path)) {
    writeGroupFile(group.root, {
      name: group.name,
      repos: [...group.repos, path],
      hosts: group.hosts,
    });
  }
  return loadGroup(group.root);
}

export function removeGroupRepo(root: string, repo: string): Group {
  const group = loadGroup(resolve(root));
  const path = resolve(group.root, repo);
  if (!group.repos.includes(path)) {
    throw new CarnetError('REPO_NOT_FOUND', `${path} is not a repo of ${group.name}`);
  }
  writeGroupFile(group.root, {
    name: group.name,
    repos: group.repos.filter((repo) => repo !== path),
    hosts: group.hosts,
  });
  return loadGroup(group.root);
}
