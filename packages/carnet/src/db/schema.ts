import type { DatabaseSync } from 'node:sqlite';

export const migrations: readonly string[] = [
  `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE,
  purpose TEXT,
  status TEXT NOT NULL DEFAULT 'temporary'
    CHECK (status IN ('temporary', 'active', 'paused', 'dropped')),
  cwd TEXT,
  repo TEXT,
  claude_pid INTEGER,
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL
);

CREATE TABLE agents (
  session TEXT NOT NULL REFERENCES sessions(id),
  name TEXT NOT NULL,
  task TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('running', 'discussing', 'answer', 'review', 'apply', 'test', 'commit', 'branch', 'closed')),
  note TEXT,
  report_path TEXT,
  base_commit TEXT,
  worktree TEXT,
  queue_order INTEGER,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session, name)
);

CREATE TABLE table_items (
  session TEXT PRIMARY KEY REFERENCES sessions(id),
  text TEXT NOT NULL,
  status TEXT,
  main_working INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  session TEXT NOT NULL REFERENCES sessions(id),
  at TEXT NOT NULL,
  type TEXT NOT NULL
    CHECK (type IN ('started', 'finished', 'answered', 'applied', 'tested', 'committed', 'dropped')),
  agent TEXT,
  commit_sha TEXT,
  link TEXT,
  note TEXT
);

CREATE INDEX events_session_at ON events(session, at);
CREATE INDEX agents_session_status ON agents(session, status);
`,
  `
ALTER TABLE agents ADD COLUMN claude_agent_id TEXT;
`,
  `
ALTER TABLE sessions ADD COLUMN hooked_at TEXT;
CREATE INDEX sessions_claude_pid ON sessions(claude_pid, hooked_at);
`,
  `
ALTER TABLE agents ADD COLUMN pending_status TEXT;
ALTER TABLE agents ADD COLUMN done_at TEXT;
`,
];

export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  return row.user_version;
}

export function migrate(db: DatabaseSync): void {
  const current = schemaVersion(db);
  for (const [version, migration] of migrations.entries()) {
    if (version < current) continue;
    db.exec('BEGIN');
    try {
      db.exec(migration);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
