import { rmSync } from 'node:fs';
import {
  type Carnet,
  formatClock,
  type Workspace,
  workspaceExists,
  workspaceLabel,
  hostById,
  loadWorkspace,
  type MoveOptions,
  moveSession,
  repoPathFor,
  type Session,
  shortId,
} from '@rucher/carnet';
import { paint } from '../color.ts';
import { warnNoWorkspace } from '../workspace-option.ts';
import type { Io } from '../io.ts';
import { CliError, findSession } from '../session.ts';

export interface SessionsOptions {
  all?: boolean | undefined;
  now?: Date | undefined;
}

function lastActive(at: string, now: Date): string {
  const date = new Date(at);
  return date.toDateString() === now.toDateString()
    ? formatClock(date)
    : date.toISOString().slice(0, 10);
}

function row(carnet: Carnet, session: Session, now: Date): string[] {
  const open = carnet.agents.list(session.id).length;
  return [
    session.name ?? session.id.slice(0, 8),
    session.kind,
    session.status,
    repoPathFor(carnet.workspace, session.cwd) ?? session.repo ?? '',
    lastActive(session.lastActiveAt, now),
    open ? `${open} agent${open > 1 ? 's' : ''}` : '',
    session.purpose ?? '',
  ];
}

export function sessionsOnce(carnet: Carnet, io: Io, options: SessionsOptions = {}): void {
  const colors = paint(io);
  const sessions = carnet.sessions.list({
    includeTemp: options.all,
    includeArchived: options.all,
  });
  warnNoWorkspace(carnet, io);
  if (sessions.length === 0) {
    const hint = options.all ? '' : ' (temp and archived ones are hidden, use --all)';
    if (carnet.workspace) io.stdout(`${colors.dim(`no active session yet${hint}`)}\n`);
    return;
  }
  const now = options.now ?? new Date();
  const rows = sessions.map((session) => ({ session, cells: row(carnet, session, now) }));
  const widths = rows.reduce<number[]>(
    (current, { cells }) =>
      cells.map((cell, column) => Math.max(current[column] ?? 0, cell.length)),
    [],
  );
  const lines = rows.map(({ session, cells }) => {
    const styled = cells.map((cell, column) => {
      const padded = column < cells.length - 1 ? cell.padEnd(widths[column] ?? 0) : cell;
      if (column === 0) return colors.bold(padded);
      if (column === 1 && session.kind === 'temp') return colors.dim(padded);
      if (column === 2 && session.status === 'archived') return colors.dim(padded);
      return padded;
    });
    return styled.join('  ').trimEnd();
  });
  io.stdout(`${lines.join('\n')}\n`);
}

export function sessionsMerge(
  carnet: Carnet,
  fromReference: string,
  intoReference: string,
  io: Io,
): void {
  const from = findSession(carnet, fromReference);
  const into = findSession(carnet, intoReference);
  const result = carnet.sessions.merge(from.id, into.id);
  const label = (session: Session) => session.name ?? session.id.slice(0, 8);
  const lines = [
    `merged ${label(from)} into ${label(result.session)}`,
    `  agents moved: ${result.movedAgents.join(', ') || 'none'}`,
    ...(result.closedAgents.length
      ? [`  agents closed (name already used): ${result.closedAgents.join(', ')}`]
      : []),
    `  events moved: ${result.movedEvents}`,
    `  table line moved: ${result.movedTable ? 'yes' : 'no'}`,
  ];
  io.stdout(`${lines.join('\n')}\n`);
}

function label(session: Session): string {
  return session.name ?? shortId(session.id);
}

export function workspaced(name: string, io: Io): Workspace {
  if (!workspaceExists(name, io.env)) {
    throw new CliError(`No workspace named "${name}"`, 'see rucher ws list');
  }
  return loadWorkspace(name, io.env);
}

export function sessionsMove(
  carnet: Carnet,
  reference: string,
  workspaceReference: string,
  io: Io,
  options: MoveOptions = {},
): void {
  const session = findSession(carnet, reference);
  const target = workspaced(workspaceReference, io).name;
  const result = moveSession(carnet, session.id, target, options);
  const into = result.into ? ` into ${label(result.into)}` : '';
  const lines = [
    `${options.dryRun ? 'would move' : 'moved'} ${label(session)} from ${workspaceLabel(carnet.workspace)} to ${target}${into}`,
    `  agents moved: ${result.movedAgents.join(', ') || 'none'}`,
    ...(result.skippedAgents.length
      ? [`  agents left out (name already used): ${result.skippedAgents.join(', ')}`]
      : []),
    `  events moved: ${result.movedEvents}`,
    `  table line moved: ${result.movedTable ? 'yes' : 'no'}`,
    ...(result.keptNotes
      ? [`  notes kept in ${workspaceLabel(carnet.workspace)}: ${result.keptNotes}`]
      : []),
  ];
  io.stdout(`${lines.join('\n')}\n`);
}

export function sessionsRename(carnet: Carnet, reference: string, name: string, io: Io): void {
  const session = carnet.sessions.rename(findSession(carnet, reference).id, name);
  io.stdout(
    `renamed to ${session.name}; rucher resume ${session.name} gives Claude the same title\n`,
  );
}

export function sessionsPromote(
  carnet: Carnet,
  reference: string,
  name: string | undefined,
  io: Io,
): void {
  const session = carnet.sessions.promote(findSession(carnet, reference).id, name);
  io.stdout(`${label(session)} is now active\n`);
}

export function sessionsDemote(carnet: Carnet, reference: string, io: Io): void {
  const session = carnet.sessions.demote(findSession(carnet, reference).id);
  io.stdout(`${label(session)} is now temp, cleaned by rucher sessions clean once idle\n`);
}

function purgeTranscripts(session: Session, io: Io): void {
  const files = hostById(session.host).transcriptFiles(session, io.env);
  for (const file of files) {
    rmSync(file, { recursive: true, force: true });
    io.stdout(`  deleted ${file}\n`);
  }
  if (files.length === 0) io.stdout('  no transcript found\n');
}

export interface DropOptions {
  purge?: boolean | undefined;
}

export function sessionsDrop(
  carnet: Carnet,
  reference: string,
  io: Io,
  options: DropOptions = {},
): void {
  const session = findSession(carnet, reference);
  if (options.purge && session.status === 'running') {
    throw new CliError(
      `Session ${label(session)} is running`,
      'drop it with --purge once it has ended',
    );
  }
  carnet.sessions.drop(session.id);
  io.stdout(`archived ${label(session)}\n`);
  if (options.purge) purgeTranscripts(session, io);
}

const UNIT_MILLISECONDS: Readonly<Record<string, number>> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDuration(value: string): number {
  const match = /^(\d+(?:\.\d+)?)([mhd]?)$/.exec(value.trim());
  if (!match)
    throw new CliError(`Invalid duration "${value}"`, 'use a number of days, or 30m, 12h, 7d');
  return Number(match[1]) * (UNIT_MILLISECONDS[match[2] || 'd'] ?? 0);
}

export function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface CleanOptions {
  olderThan?: string | undefined;
  purge?: boolean | undefined;
  dryRun?: boolean | undefined;
  isAlive?: ((processId: number) => boolean) | undefined;
}

export function sessionsClean(carnet: Carnet, io: Io, options: CleanOptions = {}): void {
  const olderThan = parseDuration(options.olderThan ?? '7d');
  if (!options.dryRun) {
    for (const session of carnet.sessions.resetDead(options.isAlive ?? processIsAlive)) {
      io.stdout(`${label(session)} was marked running but its process is gone: now idle\n`);
    }
  }
  const stale = carnet.sessions.staleTemp(olderThan);
  if (stale.length === 0) {
    io.stdout(`no temp session idle for more than ${options.olderThan ?? '7d'}\n`);
    return;
  }
  for (const session of stale) {
    if (options.dryRun) {
      io.stdout(
        `would archive ${label(session)}${options.purge ? ' and delete its transcript' : ''}\n`,
      );
      continue;
    }
    carnet.sessions.drop(session.id);
    io.stdout(`archived ${label(session)}\n`);
    if (options.purge) purgeTranscripts(session, io);
  }
}
