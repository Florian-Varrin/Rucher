import { type Ctx, nowIso } from './context.ts';
import { CarnetError } from './errors.ts';
import { logEvent } from './events.ts';
import { type Group, repoNameFor } from './group/locate.ts';
import { DEFAULT_HOST, type HostSessionPayload } from './hosts/host.ts';

export type SessionKind = 'active' | 'temp';
export type SessionStatus = 'running' | 'idle' | 'archived';

export interface Session {
  id: string;
  name: string | null;
  purpose: string | null;
  kind: SessionKind;
  status: SessionStatus;
  cwd: string | null;
  repo: string | null;
  host: string;
  hostPid: number | null;
  hookedAt: string | null;
  lastTitle: string | null;
  parentId: string | null;
  promptVersion: string | null;
  createdAt: string;
  lastActiveAt: string;
  endedAt: string | null;
}

interface SessionRow {
  id: string;
  name: string | null;
  purpose: string | null;
  kind: SessionKind;
  status: SessionStatus;
  cwd: string | null;
  repo: string | null;
  host: string;
  host_pid: number | null;
  hooked_at: string | null;
  last_title: string | null;
  parent_id: string | null;
  prompt_version: string | null;
  created_at: string;
  last_active_at: string;
  ended_at: string | null;
}

export type HookSessionPayload = HostSessionPayload;

export interface HookEnv {
  host?: string | undefined;
  processId?: number | null | undefined;
  RUCHER_PURGE_DAYS?: string | undefined;
  RUCHER_HOME?: string | undefined;
  RUCHER_SESSION_ID?: string | undefined;
  RUCHER_SESSION_KIND?: string | undefined;
  RUCHER_SESSION_NAME?: string | undefined;
  RUCHER_PROMPT_VERSION?: string | undefined;
}

export interface CreateSessionInput {
  id: string;
  kind: SessionKind;
  name?: string | null | undefined;
  cwd: string;
  repo?: string | null | undefined;
  host?: string | undefined;
}

export interface ListSessionsOptions {
  includeTemp?: boolean | undefined;
  includeArchived?: boolean | undefined;
}

const COLUMNS = `id, name, purpose, kind, status, cwd, repo, host, host_pid, hooked_at, last_title,
  parent_id, prompt_version, created_at, last_active_at, ended_at`;

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    name: row.name,
    purpose: row.purpose,
    kind: row.kind,
    status: row.status,
    cwd: row.cwd,
    repo: row.repo,
    host: row.host,
    hostPid: row.host_pid,
    hookedAt: row.hooked_at,
    lastTitle: row.last_title,
    parentId: row.parent_id,
    promptVersion: row.prompt_version,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    endedAt: row.ended_at,
  };
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
      'INSERT INTO sessions (id, cwd, repo, created_at, last_active_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, cwd ?? null, group ? repoNameFor(group, cwd) : null, at, at);
  return requireSession(ctx, id);
}

function nameTaken(error: unknown, name: string | null | undefined): never {
  if (name && error instanceof Error && error.message.includes('UNIQUE')) {
    throw new CarnetError('SESSION_NAME_TAKEN', `A session named "${name}" already exists`);
  }
  throw error;
}

export function createSession(ctx: Ctx, input: CreateSessionInput): Session {
  if (input.kind === 'active' && !input.name) {
    throw new CarnetError('SESSION_NAME_REQUIRED', 'An active session needs a name');
  }
  const at = nowIso(ctx);
  try {
    ctx.db
      .prepare(
        `INSERT INTO sessions (id, name, kind, status, cwd, repo, host, last_title,
           created_at, last_active_at)
         VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.name ?? null,
        input.kind,
        input.cwd,
        input.repo ?? null,
        input.host ?? DEFAULT_HOST,
        input.name ?? null,
        at,
        at,
      );
  } catch (error) {
    nameTaken(error, input.name);
  }
  return requireSession(ctx, input.id);
}

export function setSessionKind(
  ctx: Ctx,
  id: string,
  kind: SessionKind,
  name?: string | null,
): Session {
  const session = requireSession(ctx, id);
  const nextName = name ?? session.name;
  if (kind === 'active' && !nextName) {
    throw new CarnetError('SESSION_NAME_REQUIRED', 'An active session needs a name');
  }
  try {
    ctx.db
      .prepare('UPDATE sessions SET kind = ?, name = ?, last_title = ? WHERE id = ?')
      .run(kind, nextName, nextName ?? session.lastTitle, id);
  } catch (error) {
    nameTaken(error, nextName);
  }
  return requireSession(ctx, id);
}

// Both the launching process and the SessionEnd hook report the end: only the first one counts.
export function endSession(ctx: Ctx, id: string): Session {
  const session = requireSession(ctx, id);
  if (session.status !== 'running') return session;
  const ended = setSessionStatus(ctx, id, 'idle');
  logEvent(ctx, id, { type: 'session.ended' });
  return ended;
}

function titleAvailable(ctx: Ctx, id: string, title: string): boolean {
  const owner = sessionByName(ctx, title);
  return !owner || owner.id === id;
}

// The Rucher name is canonical: a host title only renames the session when the title itself
// changed since it was last seen, so a rename made in Rucher survives the next prompt.
export function adoptTitle(ctx: Ctx, id: string, rawTitle: string | undefined): Session {
  const session = requireSession(ctx, id);
  const title = rawTitle?.trim() || null;
  if (title === null || title === session.lastTitle) return session;
  ctx.db.prepare('UPDATE sessions SET last_title = ? WHERE id = ?').run(title, id);
  if (title === session.name || !titleAvailable(ctx, id, title)) return requireSession(ctx, id);
  ctx.db
    .prepare(
      `UPDATE sessions
       SET name = ?, kind = CASE WHEN name IS NULL THEN 'active' ELSE kind END
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
  const host = env.host ?? DEFAULT_HOST;
  const hostPid = env.processId ?? null;
  const repo = repoNameFor(group, payload.cwd);
  const existing = getSession(ctx, payload.session_id);
  if (!existing) {
    ctx.db
      .prepare(
        `INSERT INTO sessions (id, cwd, repo, host, host_pid, hooked_at, created_at, last_active_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(payload.session_id, payload.cwd ?? null, repo, host, hostPid, at, at, at);
  } else {
    ctx.db
      .prepare(
        `UPDATE sessions
         SET last_active_at = ?, hooked_at = ?, cwd = ?, repo = ?, host = ?, host_pid = ?
         WHERE id = ?`,
      )
      .run(
        at,
        at,
        payload.cwd ?? existing.cwd,
        repo ?? existing.repo,
        host,
        hostPid ?? existing.hostPid,
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
             kind = 'active'
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
  const conditions: string[] = [];
  if (!options.includeTemp) conditions.push("kind != 'temp'");
  if (!options.includeArchived) conditions.push("status != 'archived'");
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = ctx.db
    .prepare(`SELECT ${COLUMNS} FROM sessions ${where} ORDER BY last_active_at DESC`)
    .all() as unknown as SessionRow[];
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
    .prepare("UPDATE sessions SET status = 'archived', last_active_at = ? WHERE id = ?")
    .run(at, id);
  return requireSession(ctx, id);
}

export function defaultSession(ctx: Ctx): Session | undefined {
  const row = ctx.db
    .prepare(
      `SELECT ${COLUMNS} FROM sessions WHERE status != 'archived' ORDER BY last_active_at DESC LIMIT 1`,
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

export function sessionByHostProcess(
  ctx: Ctx,
  host: string,
  processId: number,
): Session | undefined {
  const row = ctx.db
    .prepare(
      `SELECT ${COLUMNS} FROM sessions
       WHERE host = ? AND host_pid = ? AND hooked_at IS NOT NULL
       ORDER BY hooked_at DESC LIMIT 1`,
    )
    .get(host, processId) as SessionRow | undefined;
  return row && toSession(row);
}

export function recordPromptVersion(ctx: Ctx, id: string, version: string | null): Session {
  requireSession(ctx, id);
  ctx.db.prepare('UPDATE sessions SET prompt_version = ? WHERE id = ?').run(version, id);
  return requireSession(ctx, id);
}

export function setParent(ctx: Ctx, id: string, parentId: string): Session {
  requireSession(ctx, id);
  requireSession(ctx, parentId);
  ctx.db.prepare('UPDATE sessions SET parent_id = ? WHERE id = ?').run(parentId, id);
  return requireSession(ctx, id);
}

export function setSessionStatus(ctx: Ctx, id: string, status: SessionStatus): Session {
  requireSession(ctx, id);
  const at = nowIso(ctx);
  ctx.db
    .prepare(
      `UPDATE sessions
       SET status = ?, last_active_at = ?,
           ended_at = CASE WHEN ? = 'running' THEN NULL WHEN ? = 'idle' THEN ? ELSE ended_at END
       WHERE id = ?`,
    )
    .run(status, at, status, status, at, id);
  return requireSession(ctx, id);
}
