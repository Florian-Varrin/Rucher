import type { Ctx } from './context.ts';

export const DEFAULT_PURGE_DAYS = 3;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

export function purgeDays(value: string | undefined): number {
  const days = Number(value);
  return Number.isFinite(days) && days > 0 ? days : DEFAULT_PURGE_DAYS;
}

// Only sessions without agent events go: the agent journal is never deleted, lifecycle events are.
const PURGEABLE = `
  id != ? AND last_active_at < ?
  AND NOT EXISTS (
    SELECT 1 FROM events WHERE events.session = sessions.id AND events.type NOT LIKE 'session.%'
  )
  AND (
    status = 'archived'
    OR (kind = 'temp' AND NOT EXISTS (SELECT 1 FROM agents WHERE agents.session = sessions.id))
  )`;

export function purgeSessions(ctx: Ctx, keepId: string, days: number): string[] {
  const cutoff = new Date(ctx.now().getTime() - days * DAY_MILLISECONDS).toISOString();
  ctx.db.exec('BEGIN');
  try {
    const rows = ctx.db
      .prepare(`SELECT id FROM sessions WHERE ${PURGEABLE}`)
      .all(keepId, cutoff) as unknown as { id: string }[];
    const ids = rows.map((row) => row.id);
    for (const table of ['table_items', 'agents', 'events']) {
      const statement = ctx.db.prepare(`DELETE FROM ${table} WHERE session = ?`);
      for (const id of ids) statement.run(id);
    }
    const deleteSession = ctx.db.prepare('DELETE FROM sessions WHERE id = ?');
    for (const id of ids) deleteSession.run(id);
    ctx.db.exec('COMMIT');
    return ids;
  } catch (error) {
    ctx.db.exec('ROLLBACK');
    throw error;
  }
}
