import { type Ctx, nowIso } from './context.ts';
import { CarnetError } from './errors.ts';
import { logEvent } from './events.ts';
import { type AgentStatus, isAgentStatus } from './status/model.ts';
import { sanitizeNote } from './status/note.ts';

export interface Agent {
  session: string;
  name: string;
  task: string | null;
  status: AgentStatus;
  note: string | null;
  reportPath: string | null;
  baseCommit: string | null;
  worktree: string | null;
  queueOrder: number | null;
  hostAgentId: string | null;
  pendingStatus: AgentStatus | null;
  doneAt: string | null;
  startedAt: string;
  updatedAt: string;
}

export interface StartAgentInput {
  name: string;
  task: string;
  baseCommit?: string | undefined;
  worktree?: string | undefined;
}

export interface UpdateAgentInput {
  status: AgentStatus;
  note?: string | undefined;
  reportPath?: string | undefined;
}

export interface FinishAgentInput {
  reportPath: string;
  hasQuestions: boolean;
}

export interface ListAgentsOptions {
  includeClosed?: boolean;
}

export interface AgentRow {
  session: string;
  name: string;
  task: string | null;
  status: AgentStatus;
  note: string | null;
  report_path: string | null;
  base_commit: string | null;
  worktree: string | null;
  queue_order: number | null;
  host_agent_id: string | null;
  pending_status: AgentStatus | null;
  done_at: string | null;
  started_at: string;
  updated_at: string;
}

export function toAgent(row: AgentRow): Agent {
  return {
    session: row.session,
    name: row.name,
    task: row.task,
    status: row.status,
    note: row.note,
    reportPath: row.report_path,
    baseCommit: row.base_commit,
    worktree: row.worktree,
    queueOrder: row.queue_order,
    hostAgentId: row.host_agent_id,
    pendingStatus: row.pending_status,
    doneAt: row.done_at,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
  };
}

export const REPORTING_NOTE = 'reporting';
export const PUBLISH_FALLBACK_MILLISECONDS = 120_000;

export function publishPending(ctx: Ctx, session: string, name: string): void {
  const row = ctx.db
    .prepare('SELECT pending_status, report_path FROM agents WHERE session = ? AND name = ?')
    .get(session, name) as Pick<AgentRow, 'pending_status' | 'report_path'> | undefined;
  if (!row?.pending_status) return;
  ctx.db
    .prepare(
      'UPDATE agents SET status = pending_status, pending_status = NULL, note = NULL, updated_at = ? WHERE session = ? AND name = ?',
    )
    .run(nowIso(ctx), session, name);
  logEvent(ctx, session, { type: 'finished', agent: name, link: row.report_path ?? undefined });
}

// Covers a paired fork whose SubagentStop never arrives (crash, hook timeout).
function publishOverdue(ctx: Ctx, session: string): void {
  const before = new Date(ctx.now().getTime() - PUBLISH_FALLBACK_MILLISECONDS).toISOString();
  const rows = ctx.db
    .prepare(
      'SELECT name FROM agents WHERE session = ? AND pending_status IS NOT NULL AND done_at <= ?',
    )
    .all(session, before) as unknown as Pick<AgentRow, 'name'>[];
  for (const row of rows) publishPending(ctx, session, row.name);
}

export function getAgent(ctx: Ctx, session: string, name: string): Agent | undefined {
  publishOverdue(ctx, session);
  const row = ctx.db
    .prepare('SELECT * FROM agents WHERE session = ? AND name = ?')
    .get(session, name) as AgentRow | undefined;
  return row && toAgent(row);
}

function requireAgent(ctx: Ctx, session: string, name: string): Agent {
  const agent = getAgent(ctx, session, name);
  if (!agent) throw new CarnetError('AGENT_NOT_FOUND', `No agent "${name}" in this session`);
  return agent;
}

export function startAgent(ctx: Ctx, session: string, input: StartAgentInput): Agent {
  const name = sanitizeNote(input.name);
  const existing = getAgent(ctx, session, name);
  if (existing && existing.status !== 'closed') {
    throw new CarnetError('AGENT_EXISTS', `Agent "${name}" is already open in this session`);
  }
  if (existing) {
    ctx.db.prepare('DELETE FROM agents WHERE session = ? AND name = ?').run(session, name);
  }
  const at = nowIso(ctx);
  ctx.db
    .prepare(
      `INSERT INTO agents (session, name, task, status, base_commit, worktree, started_at, updated_at)
       VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`,
    )
    .run(session, name, input.task, input.baseCommit ?? null, input.worktree ?? null, at, at);
  logEvent(ctx, session, { type: 'started', agent: name, note: input.task });
  return requireAgent(ctx, session, name);
}

export function updateAgent(
  ctx: Ctx,
  session: string,
  name: string,
  input: UpdateAgentInput,
): Agent {
  const current = requireAgent(ctx, session, name);
  if (!isAgentStatus(input.status) || input.status === 'closed') {
    throw new CarnetError(
      'INVALID_STATUS',
      `Invalid agent status "${input.status}"; use agent_drop to close`,
    );
  }
  const note = input.note === undefined ? null : sanitizeNote(input.note);
  if (current.pendingStatus) publishPending(ctx, session, name);
  ctx.db
    .prepare(
      "UPDATE agents SET note = COALESCE(?, CASE WHEN status = 'running' AND ? <> 'running' THEN NULL ELSE note END), status = ?, report_path = COALESCE(?, report_path), updated_at = ? WHERE session = ? AND name = ?",
    )
    .run(note, input.status, input.status, input.reportPath ?? null, nowIso(ctx), session, name);
  return requireAgent(ctx, session, name);
}

export function finishAgent(
  ctx: Ctx,
  session: string,
  name: string,
  input: FinishAgentInput,
): Agent {
  const agent = requireAgent(ctx, session, name);
  const status: AgentStatus = input.hasQuestions ? 'answer' : 'review';
  const at = nowIso(ctx);
  // A paired fork keeps writing its final message after agent_done; SubagentStop marks the real end.
  ctx.db
    .prepare(
      'UPDATE agents SET pending_status = ?, note = ?, report_path = ?, done_at = ?, updated_at = ? WHERE session = ? AND name = ?',
    )
    .run(status, REPORTING_NOTE, input.reportPath, at, at, session, name);
  if (!agent.hostAgentId) publishPending(ctx, session, name);
  return requireAgent(ctx, session, name);
}

export function dropAgent(ctx: Ctx, session: string, name: string, reason?: string): Agent {
  requireAgent(ctx, session, name);
  ctx.db
    .prepare(
      "UPDATE agents SET status = 'closed', queue_order = NULL, updated_at = ? WHERE session = ? AND name = ?",
    )
    .run(nowIso(ctx), session, name);
  logEvent(ctx, session, { type: 'dropped', agent: name, note: reason });
  return requireAgent(ctx, session, name);
}

export function listAgents(ctx: Ctx, session: string, options: ListAgentsOptions = {}): Agent[] {
  publishOverdue(ctx, session);
  const where = options.includeClosed ? '' : "AND status != 'closed'";
  const rows = ctx.db
    .prepare(`SELECT * FROM agents WHERE session = ? ${where} ORDER BY started_at ASC, name ASC`)
    .all(session) as unknown as unknown as AgentRow[];
  return rows.map(toAgent);
}

export function reorderQueue(ctx: Ctx, session: string, names: string[]): Agent[] {
  const at = nowIso(ctx);
  ctx.db.prepare('UPDATE agents SET queue_order = NULL WHERE session = ?').run(session);
  const update = ctx.db.prepare(
    'UPDATE agents SET queue_order = ?, updated_at = ? WHERE session = ? AND name = ?',
  );
  names.forEach((name, index) => {
    update.run(index + 1, at, session, sanitizeNote(name));
  });
  return listAgents(ctx, session);
}
