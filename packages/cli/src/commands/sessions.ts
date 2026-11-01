import { type Carnet, formatClock, type Session } from '@rucher/carnet';
import { paint } from '../color.ts';
import type { Io } from '../io.ts';
import { findSession } from '../session.ts';
import { sessionWhere } from './status.ts';

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
    session.status,
    sessionWhere(carnet, session) ?? '',
    lastActive(session.lastActiveAt, now),
    open ? `${open} agent${open > 1 ? 's' : ''}` : '',
    session.purpose ?? '',
  ];
}

export function sessionsOnce(carnet: Carnet, io: Io, options: SessionsOptions = {}): void {
  const colors = paint(io);
  const sessions = carnet.sessions.list({
    includeTemporary: options.all,
    includeDropped: options.all,
  });
  if (sessions.length === 0) {
    const hint = options.all ? '' : ' (temporary ones are hidden, use --all)';
    io.stdout(`${colors.dim(`no named session yet${hint}`)}\n`);
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
      if (column === 1 && session.status !== 'active') return colors.dim(padded);
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
