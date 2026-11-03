import type { DatabaseSync } from 'node:sqlite';

export const migrations: readonly string[] = [
  `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE,
  purpose TEXT,
  status TEXT NOT NULL DEFAULT 'temporary'
    CHECK (status IN ('temporary', 'active', 'dropped')),
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
  `
UPDATE sessions SET status = 'active' WHERE status = 'paused';
`,
  `
ALTER TABLE sessions RENAME COLUMN claude_pid TO host_pid;
ALTER TABLE sessions ADD COLUMN host TEXT NOT NULL DEFAULT 'claude-code';
ALTER TABLE agents RENAME COLUMN claude_agent_id TO host_agent_id;
DROP INDEX sessions_claude_pid;
CREATE INDEX sessions_host_pid ON sessions(host, host_pid, hooked_at);
`,
  `
CREATE TABLE sessions_new (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE,
  purpose TEXT,
  kind TEXT NOT NULL DEFAULT 'temp' CHECK (kind IN ('active', 'temp')),
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('running', 'idle', 'archived')),
  cwd TEXT,
  repo TEXT,
  host TEXT NOT NULL DEFAULT 'claude-code',
  host_pid INTEGER,
  hooked_at TEXT,
  last_title TEXT,
  parent_id TEXT REFERENCES sessions(id),
  prompt_version TEXT,
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  ended_at TEXT,
  CHECK (kind = 'temp' OR name IS NOT NULL)
);
INSERT INTO sessions_new (id, name, purpose, kind, status, cwd, repo, host, host_pid, hooked_at,
  last_title, created_at, last_active_at)
SELECT id, name, purpose,
  CASE WHEN status = 'active' AND name IS NOT NULL THEN 'active'
       WHEN status = 'dropped' AND name IS NOT NULL THEN 'active'
       ELSE 'temp' END,
  CASE WHEN status = 'dropped' THEN 'archived' ELSE 'idle' END,
  cwd, repo, host, host_pid, hooked_at, name, created_at, last_active_at
FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;
CREATE INDEX sessions_host_pid ON sessions(host, host_pid, hooked_at);

CREATE TABLE events_new (
  id INTEGER PRIMARY KEY,
  session TEXT NOT NULL REFERENCES sessions(id),
  at TEXT NOT NULL,
  type TEXT NOT NULL
    CHECK (type IN ('started', 'finished', 'answered', 'applied', 'tested', 'committed', 'dropped',
      'session.started', 'session.resumed', 'session.ended', 'session.forked')),
  agent TEXT,
  commit_sha TEXT,
  link TEXT,
  note TEXT
);
INSERT INTO events_new SELECT id, session, at, type, agent, commit_sha, link, note FROM events;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
CREATE INDEX events_session_at ON events(session, at);
`,
  `
CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('learning', 'dead_end', 'decision')),
  text TEXT NOT NULL,
  session TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  agent TEXT,
  similar_notes TEXT,
  created_at TEXT NOT NULL,
  dropped_at TEXT,
  dropped_reason TEXT,
  dropped_session TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  replaced_by INTEGER REFERENCES notes(id)
);

CREATE INDEX notes_active ON notes(dropped_at, kind);
CREATE INDEX notes_session ON notes(session);

CREATE TABLE note_repos (
  note INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  repo TEXT NOT NULL,
  PRIMARY KEY (note, repo)
);

CREATE INDEX note_repos_repo ON note_repos(repo);

CREATE TABLE note_citations (
  id INTEGER PRIMARY KEY,
  note INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  session TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  agent TEXT,
  why TEXT NOT NULL,
  at TEXT NOT NULL
);

CREATE INDEX note_citations_note_at ON note_citations(note, at);
CREATE INDEX note_citations_session ON note_citations(session);

CREATE TABLE active_days (
  day TEXT PRIMARY KEY
);

CREATE TABLE session_repos (
  session TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  repo TEXT NOT NULL,
  injected_at TEXT NOT NULL,
  PRIMARY KEY (session, repo)
);
`,
];

export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  return row.user_version;
}

function foreignKeyViolations(db: DatabaseSync): number {
  return db.prepare('PRAGMA foreign_key_check').all().length;
}

export function migrate(db: DatabaseSync): void {
  const current = schemaVersion(db);
  if (current >= migrations.length) return;
  const foreignKeys = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
  // Table rebuilds need foreign keys off, and SQLite ignores that pragma inside a transaction.
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    for (const [version, migration] of migrations.entries()) {
      if (version < current) continue;
      db.exec('BEGIN');
      try {
        db.exec(migration);
        if (foreignKeyViolations(db) > 0) {
          throw new Error(`Migration ${version + 1} broke foreign keys`);
        }
        db.exec(`PRAGMA user_version = ${version + 1}`);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  } finally {
    db.exec(`PRAGMA foreign_keys = ${foreignKeys.foreign_keys ? 'ON' : 'OFF'}`);
  }
}
