import { type Agent, listAgents } from '../agents.ts';
import type { Ctx } from '../context.ts';
import { type NoteActivity, sessionNoteActivity } from '../notes.ts';
import type { Session } from '../sessions.ts';
import { getTable, type TableItem } from '../table.ts';
import { type AgentStatus, EMOJI, isUserActionStatus } from './model.ts';

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
  notes: NoteActivity[];
}

const BUCKET: Partial<Record<AgentStatus, number>> = { answer: 0, review: 1 };

function bucketOf(status: AgentStatus): number {
  return BUCKET[status] ?? 2;
}

function compareWaiting(left: Agent, right: Agent): number {
  if (left.queueOrder !== null || right.queueOrder !== null) {
    if (left.queueOrder === null) return 1;
    if (right.queueOrder === null) return -1;
    return left.queueOrder - right.queueOrder;
  }
  return (
    bucketOf(left.status) - bucketOf(right.status) || left.startedAt.localeCompare(right.startedAt)
  );
}

function toLine(agent: Agent): StatusLine {
  return {
    name: agent.name,
    status: agent.status,
    emoji: agent.status === 'closed' ? '' : EMOJI[agent.status],
    note: agent.note,
  };
}

export function formatClock(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function buildStatusView(ctx: Ctx, session: Session): StatusView {
  const agents = listAgents(ctx, session.id);
  const waiting = agents
    .filter((agent) => isUserActionStatus(agent.status))
    .sort(compareWaiting)
    .map(toLine);
  const running = agents.filter((agent) => agent.status === 'running').map(toLine);
  return {
    time: formatClock(ctx.now()),
    sessionName: session.name,
    table: getTable(ctx, session.id) ?? null,
    waiting,
    running,
    notes: sessionNoteActivity(ctx, session.id),
  };
}
