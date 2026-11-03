import { basename, resolve } from 'node:path';
import {
  addGroupRepo,
  CarnetError,
  type Group,
  removeGroupRepo,
  requireGroup,
  resolveGroup,
} from '@rucher/carnet';
import { paint } from '../color.ts';
import type { Io } from '../io.ts';
import { syncContextFiles } from './init.ts';

export function currentGroup(io: Io): Group {
  return requireGroup(resolveGroup({ cwd: io.cwd, env: io.env }).group);
}

export function groupShow(io: Io): number {
  const colors = paint(io);
  const group = currentGroup(io);
  const repos = group.repos.length
    ? group.repos.map((repo) => `  ${repo.name}  ${colors.dim(repo.path)}`).join('\n')
    : `  ${colors.dim('none')}`;
  io.stdout(
    `${colors.bold(group.name)}\nsource: ${group.source}\nworkspace: ${group.workspace}\nrepos:\n${repos}\n`,
  );
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
  return carnetErrors(io, () => {
    const found = currentGroup(io);
    const path = resolve(io.cwd, repo);
    const group = addGroupRepo(found.name, path, io.env);
    io.stdout(withNotes(`added ${basename(path)} to ${group.name}`, syncNotes(group, 'merge')));
    return 0;
  });
}

export function groupRemove(repo: string, io: Io): number {
  return carnetErrors(io, () => {
    const found = currentGroup(io);
    const path = resolve(io.cwd, repo);
    const group = removeGroupRepo(found.name, path, io.env);
    io.stdout(withNotes(`removed ${basename(path)} from ${group.name}`, syncNotes(group, 'exact')));
    return 0;
  });
}

export function groupSync(io: Io): number {
  const group = currentGroup(io);
  const notes = syncNotes(group, 'exact');
  io.stdout(
    notes.length ? withNotes(`synced ${group.name}`, notes) : `${group.name} already in sync\n`,
  );
  return 0;
}
