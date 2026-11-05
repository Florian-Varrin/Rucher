import type { DatabaseSync } from 'node:sqlite';

function inTransaction<T>(db: DatabaseSync, run: () => T): T {
  db.exec('BEGIN');
  try {
    const result = run();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// undefined: no such session; null: a session without a group.
export function sessionGroupName(db: DatabaseSync, sessionId: string): string | null | undefined {
  const row = db.prepare('SELECT group_name FROM sessions WHERE id = ?').get(sessionId) as
    | { group_name: string | null }
    | undefined;
  return row ? row.group_name : undefined;
}

export function renameGroupRows(db: DatabaseSync, from: string, to: string): void {
  inTransaction(db, () => {
    for (const table of ['sessions', 'notes', 'active_days']) {
      db.prepare(`UPDATE ${table} SET group_name = ? WHERE group_name = ?`).run(to, from);
    }
  });
}

export function archiveGroupSessions(db: DatabaseSync, name: string, at: string): number {
  return inTransaction(db, () => {
    db.prepare(
      `UPDATE agents SET status = 'closed', updated_at = ?
       WHERE status != 'closed' AND session IN (SELECT id FROM sessions WHERE group_name = ?)`,
    ).run(at, name);
    return Number(
      db
        .prepare(
          `UPDATE sessions SET status = 'archived', last_active_at = ?
           WHERE group_name = ? AND status != 'archived'`,
        )
        .run(at, name).changes,
    );
  });
}

export function deleteGroupNotes(db: DatabaseSync, name: string): number {
  return Number(db.prepare('DELETE FROM notes WHERE group_name = ?').run(name).changes);
}

export function groupSessionCounts(db: DatabaseSync): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT group_name, COUNT(*) AS count FROM sessions
       WHERE group_name IS NOT NULL AND status != 'archived' GROUP BY group_name`,
    )
    .all() as { group_name: string; count: number }[];
  return new Map(rows.map((row) => [row.group_name, Number(row.count)]));
}
