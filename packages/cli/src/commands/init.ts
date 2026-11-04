import { basename, resolve } from 'node:path';
import {
  CarnetError,
  createGroup,
  databasePath,
  type Group,
  renderWorkspace,
} from '@rucher/carnet';
import { paint } from '../color.ts';
import type { Io } from '../io.ts';

export interface InitOptions {
  name?: string | undefined;
  repos?: string[] | undefined;
}

export interface ContextFileSync {
  path: string;
  result: 'written' | 'updated' | 'unchanged' | 'no-markers';
}

export function syncContextFiles(group: Group, _mode?: 'merge' | 'exact'): ContextFileSync[] {
  const rendered = renderWorkspace(group);
  return [
    ...rendered.linked.map((path) => ({ path, result: 'updated' as const })),
    ...rendered.written.map((path) => ({ path, result: 'written' as const })),
  ];
}

export function init(options: InitOptions, io: Io): number {
  const colors = paint(io);
  let group: Group;
  try {
    group = createGroup(options.name ?? basename(io.cwd), {
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
    `${colors.bold(group.name)} created`,
    `  source: ${group.source}`,
    `  workspace: ${group.workspace}`,
    `  repos: ${group.repos.length ? group.repos.map((repo) => repo.path).join(', ') : 'none yet, add them with `rucher group add <path>`'}`,
    `  database: ${databasePath(io.env)}`,
  ];
  for (const { path, result } of syncContextFiles(group, 'merge')) {
    if (result === 'unchanged') continue;
    lines.push(
      result === 'no-markers'
        ? `  kept existing ${path} ${colors.dim('(add the rucher:repos markers to keep its repo list in sync, and a line: multi-agent work uses the rucher tools)')}`
        : `  ${result} ${path}`,
    );
  }
  lines.push(
    '',
    `Next: \`rucher new <session>\` from a repo of the group, then \`rucher status --watch\` in a side pane.`,
  );
  io.stdout(`${lines.join('\n')}\n`);
  return 0;
}
