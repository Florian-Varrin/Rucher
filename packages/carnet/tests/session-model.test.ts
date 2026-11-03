import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import {
  Carnet,
  handleSessionStart,
  MEMORY_DB,
  migrations,
  openDatabase,
  schemaVersion,
} from '../src/index.ts';
import { tempDirectory, withSession, SESSION } from './helpers.ts';

const DAY = 24 * 60 * 60 * 1000;

test('upgrades a version 6 database: kinds, statuses and the journal are carried over', () => {
  const path = join(tempDirectory(), 'carnet.db');
  const old = new DatabaseSync(path);
  for (const migration of migrations.slice(0, 6)) old.exec(migration);
  old.exec('PRAGMA user_version = 6');
  old.exec(`
    INSERT INTO sessions (id, name, status, created_at, last_active_at) VALUES
      ('t', NULL, 'temporary', 'x', 'x'),
      ('a', 'shop-auth', 'active', 'x', 'x'),
      ('d', 'shop-cart', 'dropped', 'x', 'x'),
      ('m', NULL, 'dropped', 'x', 'x');
    INSERT INTO agents (session, name, status, started_at, updated_at)
      VALUES ('a', 'banner', 'running', 'x', 'x');
    INSERT INTO events (session, at, type, agent) VALUES ('a', 'x', 'started', 'banner');
    INSERT INTO table_items (session, text, updated_at) VALUES ('a', 'review', 'x');
  `);
  old.close();

  const db = openDatabase(path);
  expect(schemaVersion(db)).toBe(migrations.length);
  expect(
    db.prepare('SELECT id, name, kind, status, last_title FROM sessions ORDER BY id').all(),
  ).toEqual([
    { id: 'a', name: 'shop-auth', kind: 'active', status: 'idle', last_title: 'shop-auth' },
    { id: 'd', name: 'shop-cart', kind: 'active', status: 'archived', last_title: 'shop-cart' },
    { id: 'm', name: null, kind: 'temp', status: 'archived', last_title: null },
    { id: 't', name: null, kind: 'temp', status: 'idle', last_title: null },
  ]);
  expect(db.prepare('SELECT session, type, agent FROM events').all()).toEqual([
    { session: 'a', type: 'started', agent: 'banner' },
  ]);
  expect(db.prepare('SELECT session, name FROM agents').all()).toEqual([
    { session: 'a', name: 'banner' },
  ]);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(
    1,
  );
  db.prepare("INSERT INTO events (session, at, type) VALUES ('a', 'x', 'session.resumed')").run();
  db.close();
});

test('an active session must have a name', () => {
  const db = openDatabase(MEMORY_DB);
  expect(() =>
    db
      .prepare(
        "INSERT INTO sessions (id, kind, created_at, last_active_at) VALUES ('s', 'active', 'x', 'x')",
      )
      .run(),
  ).toThrowError(/CHECK/);
  db.close();
});

test('the Rucher name survives a host title that did not change', () => {
  const { carnet } = withSession();
  carnet.sessions.adoptTitle(SESSION, 'shop-auth');
  expect(carnet.sessions.get(SESSION)).toMatchObject({ name: 'shop-auth', kind: 'active' });

  carnet.sessions.name(SESSION, 'shop-login');
  carnet.sessions.adoptTitle(SESSION, 'shop-auth');
  expect(carnet.sessions.get(SESSION)?.name).toBe('shop-login');

  carnet.sessions.adoptTitle(SESSION, 'shop-signup');
  expect(carnet.sessions.get(SESSION)).toMatchObject({
    name: 'shop-signup',
    lastTitle: 'shop-signup',
  });
});

test('renaming a named temp session keeps it temp', () => {
  const { carnet } = withSession();
  carnet.db.prepare("UPDATE sessions SET name = 'scratch' WHERE id = ?").run(SESSION);
  carnet.sessions.adoptTitle(SESSION, 'scratch-2');
  expect(carnet.sessions.get(SESSION)).toMatchObject({ name: 'scratch-2', kind: 'temp' });
});

test('listing hides temp and archived sessions unless asked', () => {
  const { carnet } = withSession();
  carnet.sessions.name(SESSION, 'shop-auth');
  carnet.sessions.ensure('scratch');
  carnet.sessions.ensure('old');
  carnet.sessions.name('old', 'shop-old');
  carnet.sessions.drop('old');
  const names = (options = {}) =>
    carnet.sessions
      .list(options)
      .map((session) => session.name ?? session.id)
      .sort();
  expect(names()).toEqual(['shop-auth']);
  expect(names({ includeTemp: true })).toEqual(['scratch', 'shop-auth']);
  expect(names({ includeArchived: true })).toEqual(['shop-auth', 'shop-old']);
  expect(carnet.sessions.default()?.id).not.toBe('old');
});

test('session start logs lifecycle events and brings an archived session back into use', () => {
  const { carnet, root } = withSession();
  const env = {};
  handleSessionStart(carnet, { session_id: 'fresh', cwd: root, source: 'startup' }, env);
  carnet.sessions.drop('fresh');
  const resumed = handleSessionStart(
    carnet,
    { session_id: 'fresh', cwd: root, source: 'resume' },
    env,
  );
  expect(resumed.session.status).toBe('running');
  handleSessionStart(carnet, { session_id: 'fresh', cwd: root, source: 'compact' }, env);
  expect(carnet.events.read('fresh').map((event) => event.type)).toEqual([
    'session.started',
    'session.resumed',
  ]);
  expect(carnet.events.read('fresh', 20, true)).toEqual([]);
});

test('lifecycle events do not keep an idle temp session from the purge', () => {
  const root = tempDirectory();
  const group = { root, name: 'shop', repos: [], hosts: ['claude-code'], dbPath: MEMORY_DB };
  let time = Date.parse('2026-10-20T09:00:00.000Z');
  const carnet = new Carnet(group, openDatabase(MEMORY_DB), { now: () => new Date(time) });
  handleSessionStart(carnet, { session_id: 'idle', cwd: root, source: 'startup' }, {});
  time += 4 * DAY;
  handleSessionStart(carnet, { session_id: 'current', cwd: root, source: 'startup' }, {});
  expect(carnet.sessions.get('idle')).toBeUndefined();
  expect(carnet.db.prepare("SELECT 1 FROM events WHERE session = 'idle'").all()).toEqual([]);
});

test('status, parent and prompt version setters', () => {
  const { carnet } = withSession();
  carnet.sessions.ensure('child');
  carnet.sessions.setParent('child', SESSION);
  carnet.sessions.recordPromptVersion('child', 'a1b2c3');
  carnet.sessions.setStatus('child', 'running');
  expect(carnet.sessions.get('child')).toMatchObject({
    parentId: SESSION,
    promptVersion: 'a1b2c3',
    status: 'running',
    endedAt: null,
  });
  const idle = carnet.sessions.setStatus('child', 'idle');
  expect(idle.endedAt).not.toBeNull();
});
