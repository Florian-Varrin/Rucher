import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { MEMORY_DB, migrations, openDatabase, schemaVersion } from '../src/index.ts';
import { tempDirectory } from './helpers.ts';

test('migrates an in-memory database to the latest version', () => {
  const db = openDatabase(MEMORY_DB);
  expect(schemaVersion(db)).toBe(migrations.length);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as unknown as { name: string }[];
  expect(tables.map((table) => table.name)).toEqual([
    'agents',
    'events',
    'sessions',
    'table_items',
  ]);
  db.close();
});

test('opens a file database in WAL mode and is idempotent', () => {
  const path = join(tempDirectory(), 'carnet.db');
  const first = openDatabase(path);
  const mode = first.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
  expect(mode.journal_mode).toBe('wal');
  first.close();
  const second = openDatabase(path);
  expect(schemaVersion(second)).toBe(migrations.length);
  second.close();
});

test('upgrades a version 1 database and keeps its rows', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const path = join(tempDirectory(), 'carnet.db');
  const old = new DatabaseSync(path);
  old.exec(migrations[0] ?? '');
  old.exec('PRAGMA user_version = 1');
  old.exec(
    `INSERT INTO sessions (id, created_at, last_active_at) VALUES ('s', 'x', 'x');
     INSERT INTO agents (session, name, status, started_at, updated_at) VALUES ('s', 'a', 'running', 'x', 'x');`,
  );
  old.close();
  const db = openDatabase(path);
  expect(schemaVersion(db)).toBe(migrations.length);
  expect(db.prepare('SELECT name, host_agent_id FROM agents').all()).toEqual([
    { name: 'a', host_agent_id: null },
  ]);
  db.close();
});

test('upgrades a version 2 database: existing sessions get no hooked_at', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const path = join(tempDirectory(), 'carnet.db');
  const old = new DatabaseSync(path);
  old.exec(migrations[0] ?? '');
  old.exec(migrations[1] ?? '');
  old.exec('PRAGMA user_version = 2');
  old.exec(
    "INSERT INTO sessions (id, claude_pid, created_at, last_active_at) VALUES ('s', 7, 'x', 'x')",
  );
  old.close();
  const db = openDatabase(path);
  expect(schemaVersion(db)).toBe(migrations.length);
  expect(db.prepare('SELECT id, host_pid, hooked_at FROM sessions').all()).toEqual([
    { id: 's', host_pid: 7, hooked_at: null },
  ]);
  db.close();
});

test('upgrades a version 3 database: open agents get no pending outcome', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const path = join(tempDirectory(), 'carnet.db');
  const old = new DatabaseSync(path);
  for (const migration of migrations.slice(0, 3)) old.exec(migration);
  old.exec('PRAGMA user_version = 3');
  old.exec(
    `INSERT INTO sessions (id, created_at, last_active_at) VALUES ('s', 'x', 'x');
     INSERT INTO agents (session, name, status, started_at, updated_at) VALUES ('s', 'a', 'review', 'x', 'x');`,
  );
  old.close();
  const db = openDatabase(path);
  expect(schemaVersion(db)).toBe(migrations.length);
  expect(db.prepare('SELECT name, status, pending_status, done_at FROM agents').all()).toEqual([
    { name: 'a', status: 'review', pending_status: null, done_at: null },
  ]);
  db.close();
});

test('upgrades a version 4 database: paused sessions become active', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const path = join(tempDirectory(), 'carnet.db');
  const old = new DatabaseSync(path);
  const legacyFirst = (migrations[0] ?? '').replace(
    "('temporary', 'active', 'dropped')",
    "('temporary', 'active', 'paused', 'dropped')",
  );
  for (const migration of [legacyFirst, ...migrations.slice(1, 4)]) old.exec(migration);
  old.exec('PRAGMA user_version = 4');
  old.exec(
    "INSERT INTO sessions (id, status, created_at, last_active_at) VALUES ('s', 'paused', 'x', 'x')",
  );
  old.close();
  const db = openDatabase(path);
  expect(schemaVersion(db)).toBe(migrations.length);
  expect(db.prepare('SELECT id, status FROM sessions').all()).toEqual([
    { id: 's', status: 'active' },
  ]);
  db.close();
});

test('a fresh database refuses the paused status', () => {
  const db = openDatabase(MEMORY_DB);
  expect(() =>
    db
      .prepare(
        "INSERT INTO sessions (id, status, created_at, last_active_at) VALUES ('s', 'paused', 'x', 'x')",
      )
      .run(),
  ).toThrowError(/CHECK/);
  db.close();
});

test('upgrades a version 5 database: Claude columns become host columns', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const path = join(tempDirectory(), 'carnet.db');
  const old = new DatabaseSync(path);
  for (const migration of migrations.slice(0, 5)) old.exec(migration);
  old.exec('PRAGMA user_version = 5');
  old.exec(
    `INSERT INTO sessions (id, claude_pid, hooked_at, created_at, last_active_at) VALUES ('s', 7, 'x', 'x', 'x');
     INSERT INTO agents (session, name, status, claude_agent_id, started_at, updated_at) VALUES ('s', 'a', 'running', 'agent-1', 'x', 'x');`,
  );
  old.close();
  const db = openDatabase(path);
  expect(schemaVersion(db)).toBe(migrations.length);
  expect(db.prepare('SELECT id, host, host_pid FROM sessions').all()).toEqual([
    { id: 's', host: 'claude-code', host_pid: 7 },
  ]);
  expect(db.prepare('SELECT name, host_agent_id FROM agents').all()).toEqual([
    { name: 'a', host_agent_id: 'agent-1' },
  ]);
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all();
  expect(indexes).toContainEqual({ name: 'sessions_host_pid' });
  expect(indexes).not.toContainEqual({ name: 'sessions_claude_pid' });
  db.close();
});
