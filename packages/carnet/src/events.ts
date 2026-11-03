import { type Ctx, nowIso } from './context.ts';
import { CarnetError } from './errors.ts';

export const EVENT_TYPES = [
  'started',
  'finished',
  'answered',
  'applied',
  'tested',
  'committed',
  'dropped',
] as const;

export const SESSION_EVENT_TYPES = [
  'session.started',
  'session.resumed',
  'session.ended',
  'session.forked',
] as const;

export type AgentEventType = (typeof EVENT_TYPES)[number];
export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number];
export type EventType = AgentEventType | SessionEventType;

const ALL_EVENT_TYPES: readonly string[] = [...EVENT_TYPES, ...SESSION_EVENT_TYPES];

export interface CarnetEvent {
  id: number;
  session: string;
  at: string;
  type: EventType;
  agent: string | null;
  commit: string | null;
  link: string | null;
  note: string | null;
}

export interface LogEventInput {
  type: EventType;
  agent?: string | undefined;
  commit?: string | undefined;
  link?: string | undefined;
  note?: string | undefined;
}

export interface ReadEventsOptions {
  session: string;
  limit?: number | undefined;
  agentOnly?: boolean | undefined;
}

interface EventRow {
  id: number;
  session: string;
  at: string;
  type: EventType;
  agent: string | null;
  commit_sha: string | null;
  link: string | null;
  note: string | null;
}

export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && ALL_EVENT_TYPES.includes(value);
}

function toEvent(row: EventRow): CarnetEvent {
  return {
    id: row.id,
    session: row.session,
    at: row.at,
    type: row.type,
    agent: row.agent,
    commit: row.commit_sha,
    link: row.link,
    note: row.note,
  };
}

export function logEvent(ctx: Ctx, session: string, input: LogEventInput): CarnetEvent {
  if (!isEventType(input.type)) {
    throw new CarnetError('INVALID_EVENT_TYPE', `Unknown event type "${String(input.type)}"`);
  }
  const result = ctx.db
    .prepare(
      'INSERT INTO events (session, at, type, agent, commit_sha, link, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      session,
      nowIso(ctx),
      input.type,
      input.agent ?? null,
      input.commit ?? null,
      input.link ?? null,
      input.note ?? null,
    );
  const row = ctx.db
    .prepare('SELECT * FROM events WHERE id = ?')
    .get(result.lastInsertRowid) as unknown as EventRow;
  return toEvent(row);
}

export function readEvents(
  ctx: Ctx,
  { session, limit = 20, agentOnly = false }: ReadEventsOptions,
): CarnetEvent[] {
  const filter = agentOnly ? "AND type NOT LIKE 'session.%'" : '';
  const rows = ctx.db
    .prepare(
      `SELECT * FROM (SELECT * FROM events WHERE session = ? ${filter} ORDER BY id DESC LIMIT ?) ORDER BY id ASC`,
    )
    .all(session, limit) as unknown as EventRow[];
  return rows.map(toEvent);
}
