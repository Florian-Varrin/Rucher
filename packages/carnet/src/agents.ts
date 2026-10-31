import { type Ctx, nowIso } from "./context.ts";
import { CarnetError } from "./errors.ts";
import { logEvent } from "./events.ts";
import { type AgentStatus, isAgentStatus } from "./status/model.ts";
import { sanitizeNote } from "./status/note.ts";

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
  startedAt: string;
  updatedAt: string;
}

export interface StartAgentInput {
  name: string;
  task: string;
  baseCommit?: string;
  worktree?: string;
}

export interface UpdateAgentInput {
  status: AgentStatus;
  note?: string;
}

export interface FinishAgentInput {
  reportPath: string;
  hasQuestions: boolean;
}

export interface ListAgentsOptions {
  includeClosed?: boolean;
}

interface AgentRow {
  session: string;
  name: string;
  task: string | null;
  status: AgentStatus;
  note: string | null;
  report_path: string | null;
  base_commit: string | null;
  worktree: string | null;
  queue_order: number | null;
  started_at: string;
  updated_at: string;
}

function toAgent(row: AgentRow): Agent {
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
    startedAt: row.started_at,
    updatedAt: row.updated_at,
  };
}

export function getAgent(ctx: Ctx, session: string, name: string): Agent | undefined {
  const row = ctx.db
    .prepare("SELECT * FROM agents WHERE session = ? AND name = ?")
    .get(session, name) as AgentRow | undefined;
  return row && toAgent(row);
}

function requireAgent(ctx: Ctx, session: string, name: string): Agent {
  const agent = getAgent(ctx, session, name);
  if (!agent) throw new CarnetError("AGENT_NOT_FOUND", `No agent "${name}" in this session`);
  return agent;
}

export function startAgent(ctx: Ctx, session: string, input: StartAgentInput): Agent {
  const name = sanitizeNote(input.name);
  const existing = getAgent(ctx, session, name);
  if (existing && existing.status !== "closed") {
    throw new CarnetError("AGENT_EXISTS", `Agent "${name}" is already open in this session`);
  }
  if (existing) {
    ctx.db.prepare("DELETE FROM agents WHERE session = ? AND name = ?").run(session, name);
  }
  const at = nowIso(ctx);
  ctx.db
    .prepare(
      `INSERT INTO agents (session, name, task, status, base_commit, worktree, started_at, updated_at)
       VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`,
    )
    .run(session, name, input.task, input.baseCommit ?? null, input.worktree ?? null, at, at);
  logEvent(ctx, session, { type: "started", agent: name, note: input.task });
  return requireAgent(ctx, session, name);
}

export function updateAgent(
  ctx: Ctx,
  session: string,
  name: string,
  input: UpdateAgentInput,
): Agent {
  requireAgent(ctx, session, name);
  if (!isAgentStatus(input.status) || input.status === "closed") {
    throw new CarnetError(
      "INVALID_STATUS",
      `Invalid agent status "${input.status}"; use agent_drop to close`,
    );
  }
  const note = input.note === undefined ? null : sanitizeNote(input.note);
  ctx.db
    .prepare(
      "UPDATE agents SET status = ?, note = COALESCE(?, note), updated_at = ? WHERE session = ? AND name = ?",
    )
    .run(input.status, note, nowIso(ctx), session, name);
  return requireAgent(ctx, session, name);
}

export function finishAgent(
  ctx: Ctx,
  session: string,
  name: string,
  input: FinishAgentInput,
): Agent {
  requireAgent(ctx, session, name);
  const status: AgentStatus = input.hasQuestions ? "answer" : "review";
  ctx.db
    .prepare(
      "UPDATE agents SET status = ?, report_path = ?, updated_at = ? WHERE session = ? AND name = ?",
    )
    .run(status, input.reportPath, nowIso(ctx), session, name);
  logEvent(ctx, session, { type: "finished", agent: name, link: input.reportPath });
  return requireAgent(ctx, session, name);
}

export function dropAgent(ctx: Ctx, session: string, name: string, reason?: string): Agent {
  requireAgent(ctx, session, name);
  ctx.db
    .prepare(
      "UPDATE agents SET status = 'closed', queue_order = NULL, updated_at = ? WHERE session = ? AND name = ?",
    )
    .run(nowIso(ctx), session, name);
  logEvent(ctx, session, { type: "dropped", agent: name, note: reason });
  return requireAgent(ctx, session, name);
}

export function listAgents(ctx: Ctx, session: string, options: ListAgentsOptions = {}): Agent[] {
  const where = options.includeClosed ? "" : "AND status != 'closed'";
  const rows = ctx.db
    .prepare(`SELECT * FROM agents WHERE session = ? ${where} ORDER BY started_at ASC, name ASC`)
    .all(session) as unknown as unknown as AgentRow[];
  return rows.map(toAgent);
}

export function reorderQueue(ctx: Ctx, session: string, names: string[]): Agent[] {
  const at = nowIso(ctx);
  ctx.db.prepare("UPDATE agents SET queue_order = NULL WHERE session = ?").run(session);
  const update = ctx.db.prepare(
    "UPDATE agents SET queue_order = ?, updated_at = ? WHERE session = ? AND name = ?",
  );
  names.forEach((name, index) => {
    update.run(index + 1, at, session, sanitizeNote(name));
  });
  return listAgents(ctx, session);
}
