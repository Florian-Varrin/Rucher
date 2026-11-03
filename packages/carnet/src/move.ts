import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Carnet } from './carnet.ts';
import { CarnetError } from './errors.ts';
import type { Session } from './sessions.ts';

export interface MoveOptions {
  merge?: boolean | undefined;
  dryRun?: boolean | undefined;
}

export interface MoveResult {
  session: Session;
  into: Session | null;
  movedAgents: string[];
  skippedAgents: string[];
  movedEvents: number;
  movedTable: boolean;
  unlinkedNotes: number;
}

type Row = Record<string, SQLInputValue>;

function rows(db: DatabaseSync, sql: string, ...parameters: SQLInputValue[]): Row[] {
  return db.prepare(sql).all(...parameters) as Row[];
}

function count(db: DatabaseSync, sql: string, ...parameters: SQLInputValue[]): number {
  return Number((db.prepare(sql).get(...parameters) as { total: number }).total);
}

function insert(db: DatabaseSync, table: string, row: Row): void {
  const columns = Object.keys(row);
  db.prepare(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
  ).run(...columns.map((column) => row[column] ?? null));
}

function inTransaction(db: DatabaseSync, run: () => void): void {
  db.exec('BEGIN');
  try {
    run();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function existingTarget(target: Carnet, session: Session, merge: boolean): Session | null {
  const sameId = target.sessions.get(session.id);
  const [named] = session.name
    ? rows(target.db, 'SELECT id FROM sessions WHERE name = ?', session.name)
    : [];
  const existing = sameId ?? (named ? target.sessions.get(named.id as string) : null) ?? null;
  if (existing && !merge) {
    throw new CarnetError(
      sameId ? 'SESSION_EXISTS' : 'SESSION_NAME_TAKEN',
      `Group ${target.group?.name ?? '(none)'} already has session ${existing.name ?? existing.id}: pass --merge to merge into it`,
    );
  }
  return existing;
}

export function moveSession(
  source: Carnet,
  sessionId: string,
  target: Carnet,
  options: MoveOptions = {},
): MoveResult {
  if (source.group?.name === target.group?.name) {
    throw new CarnetError('SESSION_MOVE_INVALID', 'The session is already in this group');
  }
  const session = source.sessions.require(sessionId);
  const into = existingTarget(target, session, options.merge === true);
  const intoId = into?.id ?? session.id;
  const takenNames = new Set(
    rows(target.db, 'SELECT name FROM agents WHERE session = ?', intoId).map((row) => row.name),
  );
  const agents = rows(
    source.db,
    'SELECT * FROM agents WHERE session = ? ORDER BY started_at, rowid',
    session.id,
  );
  const movedAgents = agents.filter((agent) => !takenNames.has(agent.name));
  const events = rows(
    source.db,
    'SELECT * FROM events WHERE session = ? ORDER BY at, id',
    session.id,
  );
  const [table] = rows(source.db, 'SELECT * FROM table_items WHERE session = ?', session.id);
  const targetHasTable =
    rows(target.db, 'SELECT 1 FROM table_items WHERE session = ?', intoId).length > 0;
  const movedTable = table !== undefined && !targetHasTable;
  const unlinkedNotes = count(
    source.db,
    'SELECT COUNT(*) AS total FROM notes WHERE session = ? OR dropped_session = ?',
    session.id,
    session.id,
  );
  const result: MoveResult = {
    session,
    into,
    movedAgents: movedAgents.map((agent) => agent.name as string),
    skippedAgents: agents
      .filter((agent) => takenNames.has(agent.name))
      .map((agent) => agent.name as string),
    movedEvents: events.length,
    movedTable,
    unlinkedNotes,
  };
  if (options.dryRun) return result;

  inTransaction(target.db, () => {
    if (!into) {
      const [row] = rows(source.db, 'SELECT * FROM sessions WHERE id = ?', session.id);
      // The parent is a session of the source group, unknown here.
      if (row) insert(target.db, 'sessions', { ...row, parent_id: null });
    } else if (into.name === null && session.name !== null) {
      target.db
        .prepare("UPDATE sessions SET name = ?, kind = 'active' WHERE id = ?")
        .run(session.name, intoId);
    }
    for (const agent of movedAgents) insert(target.db, 'agents', { ...agent, session: intoId });
    for (const { id: _id, ...event } of events) {
      insert(target.db, 'events', { ...event, session: intoId });
    }
    if (table && movedTable) insert(target.db, 'table_items', { ...table, session: intoId });
    for (const repo of rows(
      source.db,
      'SELECT * FROM session_repos WHERE session = ?',
      session.id,
    )) {
      target.db
        .prepare(
          'INSERT OR IGNORE INTO session_repos (session, repo, injected_at) VALUES (?, ?, ?)',
        )
        .run(intoId, repo.repo ?? null, repo.injected_at ?? null);
    }
  });

  // Notes belong to their group: they stay, only their link to the moved session goes.
  inTransaction(source.db, () => {
    for (const table of ['agents', 'events', 'table_items']) {
      source.db.prepare(`DELETE FROM ${table} WHERE session = ?`).run(session.id);
    }
    source.db.prepare('UPDATE sessions SET parent_id = NULL WHERE parent_id = ?').run(session.id);
    source.db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
  });
  return result;
}
