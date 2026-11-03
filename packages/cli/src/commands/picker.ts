import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { type Carnet, formatClock, type Session, shortId } from '@rucher/carnet';
import { CliError } from '../session.ts';

export function pickerSessions(carnet: Carnet): Session[] {
  const sessions = carnet.sessions.list({ includeTemp: true });
  return [
    ...sessions.filter((session) => session.name),
    ...sessions.filter((session) => !session.name),
  ];
}

function lastUse(at: string, now: Date): string {
  const date = new Date(at);
  return date.toDateString() === now.toDateString()
    ? formatClock(date)
    : date.toISOString().slice(0, 10);
}

export function pickerLines(sessions: readonly Session[], now = new Date()): string[] {
  const rows = sessions.map((session, index) => [
    String(index + 1),
    session.name ?? shortId(session.id),
    session.kind,
    session.status,
    lastUse(session.lastActiveAt, now),
    shortId(session.id),
  ]);
  const widths = (rows[0] ?? []).map((_, column) =>
    Math.max(...rows.map((row) => (row[column] ?? '').length)),
  );
  return rows.map((row) =>
    row
      .map((cell, column) => (column < row.length - 1 ? cell.padEnd(widths[column] ?? 0) : cell))
      .join('  '),
  );
}

function hasFzf(): boolean {
  return spawnSync('fzf', ['--version'], { stdio: 'ignore' }).status === 0;
}

function pickWithFzf(sessions: readonly Session[], lines: readonly string[]): Session | undefined {
  const result = spawnSync('fzf', ['--with-nth=2..', '--no-sort', '--prompt=session> '], {
    input: lines.join('\n'),
    stdio: ['pipe', 'pipe', 'inherit'],
    encoding: 'utf8',
  });
  const index = Number(result.stdout?.trim().split(/\s+/)[0]);
  return sessions[index - 1];
}

async function pickFromList(
  sessions: readonly Session[],
  lines: readonly string[],
): Promise<Session | undefined> {
  process.stderr.write(`${lines.join('\n')}\n`);
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await prompt.question('session number> ');
    return sessions[Number(answer.trim()) - 1];
  } finally {
    prompt.close();
  }
}

export async function pickSession(carnet: Carnet): Promise<Session> {
  const sessions = pickerSessions(carnet);
  if (sessions.length === 0) {
    throw new CliError('No session to resume in this group', 'rucher new <name>');
  }
  if (!process.stdin.isTTY) {
    throw new CliError('No session given', 'rucher resume <name, id or id prefix>');
  }
  const lines = pickerLines(sessions);
  const picked = hasFzf() ? pickWithFzf(sessions, lines) : await pickFromList(sessions, lines);
  if (!picked) throw new CliError('No session picked');
  return picked;
}
