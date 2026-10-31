import { type Agent, listAgents } from "../agents.ts";
import type { Ctx } from "../context.ts";
import type { Session } from "../sessions.ts";
import { getTable, type TableItem } from "../table.ts";
import { type AgentStatus, EMOJI, isUserActionStatus } from "./model.ts";

export interface StatusLine {
  name: string;
  status: AgentStatus;
  emoji: string;
  note: string | null;
}

export interface StatusView {
  time: string;
  sessionName: string | null;
  table: TableItem | null;
  waiting: StatusLine[];
  running: StatusLine[];
}

const BUCKET: Partial<Record<AgentStatus, number>> = { answer: 0, review: 1 };

function bucketOf(status: AgentStatus): number {
  return BUCKET[status] ?? 2;
}

function compareWaiting(a: Agent, b: Agent): number {
  if (a.queueOrder !== null || b.queueOrder !== null) {
    if (a.queueOrder === null) return 1;
    if (b.queueOrder === null) return -1;
    return a.queueOrder - b.queueOrder;
  }
  return bucketOf(a.status) - bucketOf(b.status) || a.startedAt.localeCompare(b.startedAt);
}

function toLine(agent: Agent): StatusLine {
  return {
    name: agent.name,
    status: agent.status,
    emoji: agent.status === "closed" ? "" : EMOJI[agent.status],
    note: agent.note,
  };
}

export function formatClock(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function buildStatusView(ctx: Ctx, session: Session): StatusView {
  const agents = listAgents(ctx, session.id);
  const waiting = agents
    .filter((a) => isUserActionStatus(a.status))
    .sort(compareWaiting)
    .map(toLine);
  const running = agents.filter((a) => a.status === "running").map(toLine);
  return {
    time: formatClock(ctx.now()),
    sessionName: session.name,
    table: getTable(ctx, session.id) ?? null,
    waiting,
    running,
  };
}
