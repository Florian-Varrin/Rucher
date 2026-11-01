import { basename, resolve } from 'node:path';
import {
  addGroupRepo,
  CarnetError,
  type Group,
  locateGroup,
  removeGroupRepo,
} from '@rucher/carnet';
import { paint } from '../color.ts';
import type { Io } from '../io.ts';
import { syncContextFiles } from './init.ts';

export function groupShow(io: Io): number {
  const colors = paint(io);
  const group = locateGroup({ cwd: io.cwd, env: io.env });
  const repos = group.repos.length
    ? group.repos.map((r) => `  ${basename(r)}  ${colors.dim(r)}`).join('\n')
    : `  ${colors.dim('none')}`;
  io.stdout(`${colors.bold(group.name)}  ${colors.dim(group.root)}\nrepos:\n${repos}\n`);
  return 0;
}

function syncNotes(group: Group, mode: 'merge' | 'exact'): string[] {
  return syncContextFiles(group, mode)
    .filter(({ result }) => result !== 'unchanged')
    .map(({ path, result }) =>
      result === 'no-markers'
        ? `${path} has no rucher:repos markers, update its repo list yourself`
        : `${result} ${path}`,
    );
}

function withNotes(line: string, notes: string[]): string {
  return `${line}${notes.length ? ` (${notes.join(', ')})` : ''}\n`;
}

function carnetErrors(io: Io, run: () => number): number {
  try {
    return run();
  } catch (error) {
    if (error instanceof CarnetError) {
      io.stderr(`error: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

export function groupAdd(repo: string, io: Io): number {
  const found = locateGroup({ cwd: io.cwd, env: io.env });
  return carnetErrors(io, () => {
    const path = resolve(io.cwd, repo);
    const group = addGroupRepo(found.root, path);
    io.stdout(withNotes(`added ${basename(path)} to ${group.name}`, syncNotes(group, 'merge')));
    return 0;
  });
}

export function groupRemove(repo: string, io: Io): number {
  const found = locateGroup({ cwd: io.cwd, env: io.env });
  return carnetErrors(io, () => {
    const path = resolve(io.cwd, repo);
    const group = removeGroupRepo(found.root, path);
    io.stdout(withNotes(`removed ${basename(path)} from ${group.name}`, syncNotes(group, 'exact')));
    return 0;
  });
}

export function groupSync(io: Io): number {
  const group = locateGroup({ cwd: io.cwd, env: io.env });
  const notes = syncNotes(group, 'exact');
  io.stdout(
    notes.length ? withNotes(`synced ${group.name}`, notes) : `${group.name} already in sync\n`,
  );
  return 0;
}
