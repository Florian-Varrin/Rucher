import { relative, sep } from "node:path";
import { type Ctx, nowIso } from "./context.ts";
import { CarnetError } from "./errors.ts";

export type SessionStatus = "temporary" | "active" | "paused" | "dropped";

export interface Session {
  id: string;
  name: string | null;
  purpose: string | null;
  status: SessionStatus;
  cwd: string | null;
  repo: string | null;
  claudePid: number | null;
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
  created_at: string;
  last_active_at: string;
}

export interface HookSessionPayload {
  session_id: string;
  cwd?: string;
  source?: string;
  session_title?: string;
}

export interface HookEnv {
  CLAUDE_PID?: string;
}

export interface ListSessionsOptions {
  includeTemporary?: boolean;
  includeDropped?: boolean;
}

const COLUMNS = "id, name, purpose, status, cwd, repo, claude_pid, created_at, last_active_at";

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    name: row.name,
    purpose: row.purpose,
    status: row.status,
    cwd: row.cwd,
    repo: row.repo,
    claudePid: row.claude_pid,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
  };
}

export function repoOf(groupRoot: string, cwd: string | undefined): string | null {
  if (!cwd) return null;
  const rel = relative(groupRoot, cwd);
  if (!rel || rel.startsWith("..")) return null;
  return rel.split(sep)[0];
}

function parsePid(value: string | undefined): number | null {
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export function getSession(ctx: Ctx, id: string): Session | undefined {
  const row = ctx.db.prepare(`SELECT ${COLUMNS} FROM sessions WHERE id = ?`).get(id) as
    | SessionRow
    | undefined;
  return row && toSession(row);
}

export function requireSession(ctx: Ctx, id: string): Session {
  const session = getSession(ctx, id);
  if (!session) throw new CarnetError("SESSION_NOT_FOUND", `Unknown session ${id}`);
  return session;
}

export function ensureSession(ctx: Ctx, id: string, cwd?: string, groupRoot?: string): Session {
  const existing = getSession(ctx, id);
  if (existing) return existing;
  const at = nowIso(ctx);
  ctx.db
    .prepare(
      "INSERT INTO sessions (id, status, cwd, repo, created_at, last_active_at) VALUES (?, 'temporary', ?, ?, ?, ?)",
    )
    .run(id, cwd ?? null, groupRoot ? repoOf(groupRoot, cwd) : null, at, at);
  return requireSession(ctx, id);
}

export function upsertFromHook(
  ctx: Ctx,
  groupRoot: string,
  payload: HookSessionPayload,
  env: HookEnv = {},
): Session {
  const at = nowIso(ctx);
  const pid = parsePid(env.CLAUDE_PID);
  const repo = repoOf(groupRoot, payload.cwd);
  const title = payload.session_title?.trim() || null;
  const existing = getSession(ctx, payload.session_id);
  if (!existing) {
    ctx.db
      .prepare(
        `INSERT INTO sessions (id, name, status, cwd, repo, claude_pid, created_at, last_active_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        payload.session_id,
        title,
        title ? "active" : "temporary",
        payload.cwd ?? null,
        repo,
        pid,
        at,
        at,
      );
  } else {
    const adoptTitle = title !== null && existing.name === null;
    ctx.db
      .prepare(
        `UPDATE sessions
         SET last_active_at = ?, cwd = ?, repo = ?, claude_pid = ?,
             name = CASE WHEN ? THEN ? ELSE name END,
             status = CASE WHEN ? AND status = 'temporary' THEN 'active' ELSE status END
         WHERE id = ?`,
      )
      .run(
        at,
        payload.cwd ?? existing.cwd,
        repo ?? existing.repo,
        pid ?? existing.claudePid,
        adoptTitle ? 1 : 0,
        title,
        adoptTitle ? 1 : 0,
        payload.session_id,
      );
  }
  return requireSession(ctx, payload.session_id);
}

export function touchSession(ctx: Ctx, id: string): void {
  ctx.db.prepare("UPDATE sessions SET last_active_at = ? WHERE id = ?").run(nowIso(ctx), id);
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
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      throw new CarnetError("SESSION_NAME_TAKEN", `A session named "${name}" already exists`);
    }
    throw error;
  }
  return requireSession(ctx, id);
}

export function listSessions(ctx: Ctx, options: ListSessionsOptions = {}): Session[] {
  const excluded: SessionStatus[] = [];
  if (!options.includeTemporary) excluded.push("temporary");
  if (!options.includeDropped) excluded.push("dropped");
  const placeholders = excluded.map(() => "?").join(", ");
  const where = excluded.length ? `WHERE status NOT IN (${placeholders})` : "";
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

export function sessionByClaudePid(ctx: Ctx, pid: number): Session | undefined {
  const row = ctx.db
    .prepare(
      `SELECT ${COLUMNS} FROM sessions WHERE claude_pid = ? ORDER BY last_active_at DESC LIMIT 1`,
    )
    .get(pid) as SessionRow | undefined;
  return row && toSession(row);
}
