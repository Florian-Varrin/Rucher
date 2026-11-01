import { type Ctx, nowIso } from './context.ts';
import { CarnetError } from './errors.ts';
import { requireSession, type Session } from './sessions.ts';

export interface MergeResult {
  session: Session;
  movedAgents: string[];
  closedAgents: string[];
  movedEvents: number;
  movedTable: boolean;
}

function namesOf(ctx: Ctx, session: string): string[] {
  const rows = ctx.db
    .prepare('SELECT name FROM agents WHERE session = ?')
    .all(session) as unknown as {
    name: string;
  }[];
  return rows.map((row) => row.name);
}

export function mergeSessions(ctx: Ctx, fromId: string, intoId: string): MergeResult {
  if (fromId === intoId) {
    throw new CarnetError('SESSION_MERGE_INVALID', 'Cannot merge a session into itself');
  }
  const from = requireSession(ctx, fromId);
  const into = requireSession(ctx, intoId);
  const at = nowIso(ctx);
  const taken = new Set(namesOf(ctx, intoId));
  const fromNames = namesOf(ctx, fromId);
  const movedAgents = fromNames.filter((name) => !taken.has(name));
  const closedAgents = fromNames.filter((name) => taken.has(name));
  ctx.db.exec('BEGIN');
  try {
    const moveAgent = ctx.db.prepare(
      'UPDATE agents SET session = ?, updated_at = ? WHERE session = ? AND name = ?',
    );
    for (const name of movedAgents) moveAgent.run(intoId, at, fromId, name);
    ctx.db
      .prepare(
        "UPDATE agents SET status = 'closed', updated_at = ? WHERE session = ? AND status != 'closed'",
      )
      .run(at, fromId);
    const movedEvents = Number(
      ctx.db.prepare('UPDATE events SET session = ? WHERE session = ?').run(intoId, fromId).changes,
    );
    const intoHasTable =
      ctx.db.prepare('SELECT 1 FROM table_items WHERE session = ?').get(intoId) !== undefined;
    const movedTable =
      !intoHasTable &&
      Number(
        ctx.db.prepare('UPDATE table_items SET session = ? WHERE session = ?').run(intoId, fromId)
          .changes,
      ) > 0;
    ctx.db.prepare('DELETE FROM table_items WHERE session = ?').run(fromId);
    const keepName = into.name === null && from.name !== null;
    ctx.db
      .prepare(
        "UPDATE sessions SET status = 'dropped', name = NULL, last_active_at = ? WHERE id = ?",
      )
      .run(at, fromId);
    ctx.db
      .prepare(
        `UPDATE sessions
         SET name = COALESCE(?, name), purpose = COALESCE(purpose, ?), last_active_at = ?,
             status = CASE WHEN ? AND status = 'temporary' THEN 'active' ELSE status END
         WHERE id = ?`,
      )
      .run(keepName ? from.name : null, from.purpose, at, keepName ? 1 : 0, intoId);
    ctx.db.exec('COMMIT');
    return {
      session: requireSession(ctx, intoId),
      movedAgents,
      closedAgents,
      movedEvents,
      movedTable,
    };
  } catch (error) {
    ctx.db.exec('ROLLBACK');
    throw error;
  }
}
