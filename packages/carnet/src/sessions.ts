import { type Ctx, nowIso } from './context.ts';
import { CarnetError } from './errors.ts';
import { type Group, repoNameFor } from './group/locate.ts';

export type SessionStatus = 'temporary' | 'active' | 'paused' | 'dropped';

export interface Session {
  id: string;
  name: string | null;
  purpose: string | null;
  status: SessionStatus;
  cwd: string | null;
  repo: string | null;
  claudePid: number | null;
  hookedAt: string | null;
  createdAt: string;
  lastActiveAt: string;
}

interface SessionRow {
  id: string;
  name: string | null;
  purpose: string | null;
  status: SessionStatus;
  cwd: string | null;
  repo: string | null;
  claude_pid: number | null;
  hooked_at: string | null;
  created_at: string;
  last_active_at: string;
}

export interface HookSessionPayload {
  session_id: string;
  cwd?: string | undefined;
  source?: string | undefined;
  session_title?: string | undefined;
}

export interface HookEnv {
  CLAUDE_PID?: string | undefined;
}

export interface ListSessionsOptions {
  includeTemporary?: boolean | undefined;
  includeDropped?: boolean | undefined;
}

const COLUMNS =
  'id, name, purpose, status, cwd, repo, claude_pid, hooked_at, created_at, last_active_at';

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    name: row.name,
    purpose: row.purpose,
    status: row.status,
    cwd: row.cwd,
    repo: row.repo,
    claudePid: row.claude_pid,
    hookedAt: row.hooked_at,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
  };
}

function parseProcessId(value: string | undefined): number | null {
  const processId = Number(value);
  return Number.isInteger(processId) && processId > 0 ? processId : null;
}

export function getSession(ctx: Ctx, id: string): Session | undefined {
  const row = ctx.db.prepare(`SELECT ${COLUMNS} FROM sessions WHERE id = ?`).get(id) as
    | SessionRow
    | undefined;
  return row && toSession(row);
}

export function requireSession(ctx: Ctx, id: string): Session {
  const session = getSession(ctx, id);
  if (!session) throw new CarnetError('SESSION_NOT_FOUND', `Unknown session ${id}`);
  return session;
}

export function ensureSession(ctx: Ctx, id: string, cwd?: string, group?: Group): Session {
  const existing = getSession(ctx, id);
  if (existing) return existing;
  const at = nowIso(ctx);
  ctx.db
    .prepare(
      "INSERT INTO sessions (id, status, cwd, repo, created_at, last_active_at) VALUES (?, 'temporary', ?, ?, ?, ?)",
    )
    .run(id, cwd ?? null, group ? repoNameFor(group, cwd) : null, at, at);
  return requireSession(ctx, id);
}

function titleAvailable(ctx: Ctx, id: string, title: string): boolean {
  const owner = sessionByName(ctx, title);
  return !owner || owner.id === id;
}

export function adoptTitle(ctx: Ctx, id: string, rawTitle: string | undefined): Session {
  const session = requireSession(ctx, id);
  const title = rawTitle?.trim() || null;
  if (title === null || title === session.name || !titleAvailable(ctx, id, title)) return session;
  ctx.db
    .prepare(
      `UPDATE sessions
       SET name = ?, status = CASE WHEN status = 'temporary' THEN 'active' ELSE status END
       WHERE id = ?`,
    )
    .run(title, id);
  return requireSession(ctx, id);
}

export function upsertFromHook(
  ctx: Ctx,
  group: Group,
  payload: HookSessionPayload,
  env: HookEnv = {},
): Session {
  const at = nowIso(ctx);
  const claudePid = parseProcessId(env.CLAUDE_PID);
  const repo = repoNameFor(group, payload.cwd);
  const existing = getSession(ctx, payload.session_id);
  if (!existing) {
    ctx.db
      .prepare(
        `INSERT INTO sessions (id, status, cwd, repo, claude_pid, hooked_at, created_at, last_active_at)
         VALUES (?, 'temporary', ?, ?, ?, ?, ?, ?)`,
      )
      .run(payload.session_id, payload.cwd ?? null, repo, claudePid, at, at, at);
  } else {
    ctx.db
      .prepare(
        `UPDATE sessions
         SET last_active_at = ?, hooked_at = ?, cwd = ?, repo = ?, claude_pid = ?
         WHERE id = ?`,
      )
      .run(
        at,
        at,
        payload.cwd ?? existing.cwd,
        repo ?? existing.repo,
        claudePid ?? existing.claudePid,
        payload.session_id,
      );
  }
  return adoptTitle(ctx, payload.session_id, payload.session_title);
}

export function touchSession(ctx: Ctx, id: string): void {
  ctx.db.prepare('UPDATE sessions SET last_active_at = ? WHERE id = ?').run(nowIso(ctx), id);
}

export function nameSession(ctx: Ctx, id: string, name: string, purpose?: string): Session {
  requireSession(ctx, id);
  try {
    ctx.db
      .prepare(
        `UPDATE sessions
         SET name = ?, purpose = COALESCE(?, purpose), last_active_at = ?,
             status = CASE WHEN status = 'temporary' THEN 'active' ELSE status END
         WHERE id = ?`,
      )
      .run(name, purpose ?? null, nowIso(ctx), id);
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE')) {
      throw new CarnetError('SESSION_NAME_TAKEN', `A session named "${name}" already exists`);
    }
    throw error;
  }
  return requireSession(ctx, id);
}

export function listSessions(ctx: Ctx, options: ListSessionsOptions = {}): Session[] {
  const excluded: SessionStatus[] = [];
  if (!options.includeTemporary) excluded.push('temporary');
  if (!options.includeDropped) excluded.push('dropped');
  const placeholders = excluded.map(() => '?').join(', ');
  const where = excluded.length ? `WHERE status NOT IN (${placeholders})` : '';
  const rows = ctx.db
    .prepare(`SELECT ${COLUMNS} FROM sessions ${where} ORDER BY last_active_at DESC`)
    .all(...excluded) as unknown as unknown as SessionRow[];
  return rows.map(toSession);
}

export function dropSession(ctx: Ctx, id: string): Session {
  requireSession(ctx, id);
  const at = nowIso(ctx);
  ctx.db
    .prepare(
      "UPDATE agents SET status = 'closed', updated_at = ? WHERE session = ? AND status != 'closed'",
    )
    .run(at, id);
  ctx.db
    .prepare("UPDATE sessions SET status = 'dropped', last_active_at = ? WHERE id = ?")
    .run(at, id);
  return requireSession(ctx, id);
}

export function defaultSession(ctx: Ctx): Session | undefined {
  const row = ctx.db
    .prepare(
      `SELECT ${COLUMNS} FROM sessions WHERE status != 'dropped' ORDER BY last_active_at DESC LIMIT 1`,
    )
    .get() as SessionRow | undefined;
  return row && toSession(row);
}

export function sessionByName(ctx: Ctx, name: string): Session | undefined {
  const row = ctx.db.prepare(`SELECT ${COLUMNS} FROM sessions WHERE name = ?`).get(name) as
    | SessionRow
    | undefined;
  return row && toSession(row);
}

export const MINIMUM_ID_PREFIX = 4;

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function findSession(ctx: Ctx, reference: string): Session {
  const byName = sessionByName(ctx, reference);
  if (byName) return byName;
  const byId = getSession(ctx, reference);
  if (byId) return byId;
  const isIdPrefix = /^[0-9a-f-]+$/i.test(reference);
  if (isIdPrefix && reference.length >= MINIMUM_ID_PREFIX) {
    const rows = ctx.db
      .prepare(`SELECT ${COLUMNS} FROM sessions WHERE id LIKE ? ORDER BY last_active_at DESC`)
      .all(`${reference.toLowerCase()}%`) as unknown as SessionRow[];
    const [only, ...others] = rows;
    if (only && others.length === 0) return toSession(only);
    if (only) {
      const matches = rows.map((row) => shortId(row.id)).join(', ');
      throw new CarnetError(
        'SESSION_AMBIGUOUS',
        `Session id "${reference}" matches several sessions: ${matches}`,
      );
    }
  }
  const hint =
    isIdPrefix && reference.length < MINIMUM_ID_PREFIX
      ? ` (an id prefix needs at least ${MINIMUM_ID_PREFIX} characters)`
      : '';
  throw new CarnetError('SESSION_NOT_FOUND', `Unknown session "${reference}"${hint}`);
}

export function sessionByClaudePid(ctx: Ctx, processId: number): Session | undefined {
  const row = ctx.db
    .prepare(
      `SELECT ${COLUMNS} FROM sessions
       WHERE claude_pid = ? AND hooked_at IS NOT NULL
       ORDER BY hooked_at DESC LIMIT 1`,
    )
    .get(processId) as SessionRow | undefined;
  return row && toSession(row);
}
