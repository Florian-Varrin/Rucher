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

// undefined: no such session; null: a session without a workspace.
export function sessionWorkspaceName(
  db: DatabaseSync,
  sessionId: string,
): string | null | undefined {
  const row = db.prepare('SELECT workspace FROM sessions WHERE id = ?').get(sessionId) as
    | { workspace: string | null }
    | undefined;
  return row ? row.workspace : undefined;
}

export function archiveWorkspaceSessions(db: DatabaseSync, name: string, at: string): number {
  return inTransaction(db, () => {
    db.prepare(
      `UPDATE agents SET status = 'closed', updated_at = ?
       WHERE status != 'closed' AND session IN (SELECT id FROM sessions WHERE workspace = ?)`,
    ).run(at, name);
    return Number(
      db
        .prepare(
          `UPDATE sessions SET status = 'archived', last_active_at = ?
           WHERE workspace = ? AND status != 'archived'`,
        )
        .run(at, name).changes,
    );
  });
}

export function deleteWorkspaceNotes(db: DatabaseSync, name: string): number {
  return Number(db.prepare('DELETE FROM notes WHERE workspace = ?').run(name).changes);
}

export function workspaceSessionCounts(db: DatabaseSync): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT workspace, COUNT(*) AS count FROM sessions
       WHERE workspace IS NOT NULL AND status != 'archived' GROUP BY workspace`,
    )
    .all() as { workspace: string; count: number }[];
  return new Map(rows.map((row) => [row.workspace, Number(row.count)]));
}
