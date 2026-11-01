import { type Agent, type AgentRow, publishPending, toAgent } from './agents.ts';
import { type Ctx, nowIso } from './context.ts';
import { logEvent } from './events.ts';

export const PAIRING_WINDOW_MILLISECONDS = 60_000;
export const STOPPED_NOTE = 'stopped without agent_done';

function byHostAgentId(ctx: Ctx, session: string, hostAgentId: string): Agent | undefined {
  const row = ctx.db
    .prepare('SELECT * FROM agents WHERE session = ? AND host_agent_id = ?')
    .get(session, hostAgentId) as AgentRow | undefined;
  return row && toAgent(row);
}

// SubagentStart fires in dispatch order, and main registers each fork in an earlier message.
export function pairSubagent(ctx: Ctx, session: string, hostAgentId: string): Agent | undefined {
  const paired = byHostAgentId(ctx, session, hostAgentId);
  if (paired) return paired;
  const since = new Date(ctx.now().getTime() - PAIRING_WINDOW_MILLISECONDS).toISOString();
  const row = ctx.db
    .prepare(
      `SELECT * FROM agents
       WHERE session = ? AND status = 'running' AND host_agent_id IS NULL AND started_at >= ?
       ORDER BY started_at ASC, rowid ASC LIMIT 1`,
    )
    .get(session, since) as AgentRow | undefined;
  if (!row) return undefined;
  ctx.db
    .prepare('UPDATE agents SET host_agent_id = ? WHERE session = ? AND name = ?')
    .run(hostAgentId, session, row.name);
  return byHostAgentId(ctx, session, hostAgentId);
}

export function stopSubagent(ctx: Ctx, session: string, hostAgentId: string): Agent | undefined {
  const agent = byHostAgentId(ctx, session, hostAgentId);
  if (!agent || agent.status !== 'running') return undefined;
  if (agent.pendingStatus) {
    publishPending(ctx, session, agent.name);
    return byHostAgentId(ctx, session, hostAgentId);
  }
  ctx.db
    .prepare(
      "UPDATE agents SET status = 'review', note = ?, updated_at = ? WHERE session = ? AND name = ?",
    )
    .run(STOPPED_NOTE, nowIso(ctx), session, agent.name);
  logEvent(ctx, session, { type: 'finished', agent: agent.name, note: STOPPED_NOTE });
  return byHostAgentId(ctx, session, hostAgentId);
}
