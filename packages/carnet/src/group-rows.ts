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
