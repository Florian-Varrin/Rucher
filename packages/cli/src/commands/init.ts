import { resolve } from 'node:path';
import {
  CarnetError,
  type ContextFileResult,
  type Group,
  hostById,
  initGroup,
} from '@rucher/carnet';
import { paint } from '../color.ts';
import type { Io } from '../io.ts';

export interface InitOptions {
  directory?: string | undefined;
  name?: string | undefined;
  repos?: string[] | undefined;
}

export interface ContextFileSync {
  path: string;
  result: ContextFileResult;
}

export function syncContextFiles(group: Group, mode: 'merge' | 'exact'): ContextFileSync[] {
  return group.hosts.flatMap((id) =>
    hostById(id).contextFiles.map((file) => ({ path: file.path, result: file.sync(group, mode) })),
  );
}

export function init(options: InitOptions, io: Io): number {
  const colors = paint(io);
  const root = resolve(io.cwd, options.directory ?? '.');
  let group: Group;
  try {
    group = initGroup(root, {
      name: options.name,
      repos: options.repos?.map((repo) => resolve(io.cwd, repo)),
      env: io.env,
    });
  } catch (error) {
    if (error instanceof CarnetError) {
      io.stderr(`error: ${error.message}\n`);
      return 1;
    }
    throw error;
  }

  const lines = [
    `${colors.bold(group.name)} initialised in ${group.root}`,
    `  repos: ${group.repos.length ? group.repos.join(', ') : 'none yet, add them with `rucher group add <path>`'}`,
    `  database: ${group.dbPath}`,
  ];
  for (const { path, result } of syncContextFiles(group, 'merge')) {
    if (result === 'unchanged') continue;
    lines.push(
      result === 'no-markers'
        ? `  kept existing ${path} ${colors.dim('(add the rucher:repos markers to keep its repo list in sync, and a line: multi-agent work uses the rucher tools)')}`
        : `  ${result} ${path}`,
    );
  }
  const hosts = group.hosts.map((id) => hostById(id).displayName).join(' or ');
  lines.push(
    '',
    `Next: start ${hosts} in this directory, then \`rucher status --watch\` in a side pane.`,
  );
  io.stdout(`${lines.join('\n')}\n`);
  return 0;
}
