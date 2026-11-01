import { type Agent, type AgentRow, toAgent } from "./agents.ts";
import { type Ctx, nowIso } from "./context.ts";
import { logEvent } from "./events.ts";

export const PAIRING_WINDOW_MS = 60_000;
export const STOPPED_NOTE = "stopped without agent_done";

function byClaudeId(ctx: Ctx, session: string, claudeAgentId: string): Agent | undefined {
  const row = ctx.db
    .prepare("SELECT * FROM agents WHERE session = ? AND claude_agent_id = ?")
    .get(session, claudeAgentId) as AgentRow | undefined;
  return row && toAgent(row);
}

// SubagentStart fires in dispatch order, and main registers each fork in an earlier message.
export function pairSubagent(ctx: Ctx, session: string, claudeAgentId: string): Agent | undefined {
  const paired = byClaudeId(ctx, session, claudeAgentId);
  if (paired) return paired;
  const since = new Date(ctx.now().getTime() - PAIRING_WINDOW_MS).toISOString();
  const row = ctx.db
    .prepare(
      `SELECT * FROM agents
       WHERE session = ? AND status = 'running' AND claude_agent_id IS NULL AND started_at >= ?
       ORDER BY started_at ASC, rowid ASC LIMIT 1`,
    )
    .get(session, since) as AgentRow | undefined;
  if (!row) return undefined;
  ctx.db
    .prepare("UPDATE agents SET claude_agent_id = ? WHERE session = ? AND name = ?")
    .run(claudeAgentId, session, row.name);
  return byClaudeId(ctx, session, claudeAgentId);
}

export function stopSubagent(ctx: Ctx, session: string, claudeAgentId: string): Agent | undefined {
  const agent = byClaudeId(ctx, session, claudeAgentId);
  if (!agent || agent.status !== "running") return undefined;
  ctx.db
    .prepare(
      "UPDATE agents SET status = 'review', note = ?, updated_at = ? WHERE session = ? AND name = ?",
    )
    .run(STOPPED_NOTE, nowIso(ctx), session, agent.name);
  logEvent(ctx, session, { type: "finished", agent: agent.name, note: STOPPED_NOTE });
  return byClaudeId(ctx, session, claudeAgentId);
}
