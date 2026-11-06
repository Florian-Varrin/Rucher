import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import {
  archiveWorkspaceSessions,
  Carnet,
  type CarnetError,
  MEMORY_DB,
  migrate,
  migrations,
  openDatabase,
  schemaVersion,
  sessionWorkspaceName,
} from '../src/index.ts';
import { workspaceAt, makeClock, tempDirectory } from './helpers.ts';

const SHOP = '0360889d-99c7-4c8f-8447-50ce30696e5a';
const BLOG = 'bb9b338a-c4a7-4b3a-82d0-fc16193a7749';
const LOOSE = 'c41d2e6a-7f0e-4a52-9a43-1b6f4b1f2a10';

function workspaceCarnet(db: DatabaseSync, name: string | null): Carnet {
  if (name === null) return new Carnet(db, null, { now: makeClock() });
  const root = tempDirectory(`${name}-`);
  return new Carnet(db, workspaceAt(root, name, [join(root, 'api')]), { now: makeClock() });
}

function twoWorkspaces() {
  const db = openDatabase(MEMORY_DB);
  return { db, shop: workspaceCarnet(db, 'shop'), blog: workspaceCarnet(db, 'blog') };
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return (error as CarnetError).code;
  }
}

test('workspaces sharing one database only see their own sessions', () => {
  const { shop, blog } = twoWorkspaces();
  shop.sessions.create({ id: SHOP, kind: 'active', name: 'auth', cwd: '/shop' });
  blog.sessions.create({ id: BLOG, kind: 'active', name: 'auth', cwd: '/blog' });
  expect(shop.sessions.list().map((session) => session.id)).toEqual([SHOP]);
  expect(blog.sessions.byName('auth')?.id).toBe(BLOG);
  expect(shop.sessions.default()?.id).toBe(SHOP);
  expect(shop.sessions.find('auth').workspace).toBe('shop');
  expect(codeOf(() => shop.sessions.find(BLOG.slice(0, 6)))).toBe('SESSION_NOT_FOUND');
});

test('session names stay unique among sessions without a workspace', () => {
  const db = openDatabase(MEMORY_DB);
  const loose = workspaceCarnet(db, null);
  loose.sessions.create({ id: LOOSE, kind: 'active', name: 'scratch', cwd: '/tmp' });
  expect(
    codeOf(() => loose.sessions.create({ id: SHOP, kind: 'active', name: 'scratch', cwd: '/' })),
  ).toBe('SESSION_NAME_TAKEN');
  workspaceCarnet(db, 'shop').sessions.create({
    id: BLOG,
    kind: 'active',
    name: 'scratch',
    cwd: '/',
  });
  expect(loose.sessions.list().map((session) => session.workspace)).toEqual([null]);
  expect(codeOf(() => loose.notes.add({ kind: 'learning', text: 'No workspace here' }))).toBe(
    'NO_WORKSPACE',
  );
});

test('note numbers start at 1 in each workspace and drive drop, cite and replacement', () => {
  const { shop, blog } = twoWorkspaces();
  shop.notes.add({ kind: 'learning', text: 'The cart caches for a minute' });
  shop.notes.add({ kind: 'decision', text: 'Prices are stored in cents' });
  const first = blog.notes.add({ kind: 'learning', text: 'Drafts are never indexed' }).note;
  expect(first.id).toBe(1);
  expect(shop.notes.list().map((note) => note.id)).toEqual([2, 1]);
  shop.notes.cite(1, { why: 'Kept the cart cache' });
  shop.notes.drop(2, { reason: 'Prices moved to a service', replacedBy: 1 });
  expect(shop.notes.get(2)).toMatchObject({ replacedBy: 1 });
  expect(shop.notes.show(1).citations.map((citation) => citation.note)).toEqual([1]);
  expect(blog.notes.show(1).citationCount).toBe(0);
  expect(codeOf(() => blog.notes.get(2) ?? blog.notes.show(2))).toBe('NOTE_NOT_FOUND');
});

test('active days are counted per workspace', () => {
  const { db, shop, blog } = twoWorkspaces();
  shop.notes.recordActiveDay();
  blog.notes.recordActiveDay();
  const days = db.prepare('SELECT workspace FROM active_days ORDER BY workspace').all();
  expect(days.map((row) => row.workspace)).toEqual(['blog', 'shop']);
});

test('the seams resolve and archive a workspace by name', () => {
  const { db, shop } = twoWorkspaces();
  shop.sessions.create({ id: SHOP, kind: 'active', name: 'auth', cwd: '/shop' });
  shop.agents.start(SHOP, { name: 'cart', task: 'Show the cart' });
  shop.notes.add({ kind: 'learning', text: 'The cart caches for a minute' });
  shop.notes.recordActiveDay();
  expect(sessionWorkspaceName(db, SHOP)).toBe('shop');
  expect(sessionWorkspaceName(db, BLOG)).toBeUndefined();
  expect(archiveWorkspaceSessions(db, 'shop', '2026-11-03T10:00:00.000Z')).toBe(1);
  expect(shop.sessions.require(SHOP).status).toBe('archived');
  expect(shop.agents.get(SHOP, 'cart')?.status).toBe('closed');
});

test('v9 keeps the rows of a v8 database, under the empty workspace name', () => {
  const db = new DatabaseSync(MEMORY_DB);
  for (const migration of migrations.slice(0, 8)) db.exec(migration);
  db.exec('PRAGMA user_version = 8');
  db.exec(`INSERT INTO sessions (id, name, kind, status, created_at, last_active_at)
    VALUES ('${SHOP}', 'auth', 'active', 'idle', '2026-11-01', '2026-11-01')`);
  db.exec(
    `INSERT INTO notes (kind, text, created_at) VALUES ('learning', 'Old note', '2026-11-01')`,
  );
  db.exec(`INSERT INTO active_days (day) VALUES ('2026-11-01')`);
  migrate(db);
  expect(sessionWorkspaceName(db, SHOP)).toBe('');
  expect(db.prepare('SELECT workspace, number FROM notes').get()).toEqual({
    workspace: '',
    number: 1,
  });
  expect(db.prepare('SELECT workspace, day FROM active_days').get()).toEqual({
    workspace: '',
    day: '2026-11-01',
  });
});

test('v10 renames the columns and indexes of a v9 database, keeping rows and NULL workspaces', () => {
  const db = new DatabaseSync(MEMORY_DB);
  db.exec('PRAGMA foreign_keys = ON');
  for (const migration of migrations.slice(0, 9)) db.exec(migration);
  db.exec('PRAGMA user_version = 9');
  const insert = db.prepare(
    `INSERT INTO sessions (id, group_name, name, kind, status, created_at, last_active_at)
     VALUES (?, ?, ?, 'active', 'idle', '2026-11-01', '2026-11-01')`,
  );
  insert.run(SHOP, 'shop', 'auth');
  insert.run(BLOG, 'blog', 'auth');
  insert.run(LOOSE, null, 'auth');
  db.exec(`INSERT INTO notes (group_name, number, kind, text, created_at)
    VALUES ('shop', 1, 'learning', 'Kept note', '2026-11-01')`);
  db.exec(`INSERT INTO active_days (group_name, day) VALUES ('shop', '2026-11-01')`);

  migrate(db);

  expect(schemaVersion(db)).toBe(10);
  expect(sessionWorkspaceName(db, SHOP)).toBe('shop');
  expect(sessionWorkspaceName(db, LOOSE)).toBeNull();
  expect(db.prepare('SELECT workspace, number FROM notes').get()).toEqual({
    workspace: 'shop',
    number: 1,
  });
  expect(db.prepare('SELECT workspace FROM active_days').get()).toEqual({ workspace: 'shop' });
  const schema = db.prepare('SELECT name, sql FROM sqlite_schema WHERE sql IS NOT NULL').all() as {
    name: string;
    sql: string;
  }[];
  expect(schema.filter(({ name, sql }) => /group/i.test(name + sql))).toEqual([]);
  expect(schema.map(({ name }) => name)).toEqual(
    expect.arrayContaining([
      'sessions_workspace_status',
      'sessions_workspace_name',
      'sessions_free_name',
      'notes_active',
      'notes_workspace_number',
    ]),
  );

  const named = `INSERT INTO sessions (id, workspace, name, kind, status, created_at, last_active_at)
    VALUES ('other', ?, 'auth', 'active', 'idle', '2026-11-01', '2026-11-01')`;
  expect(() => db.prepare(named).run('shop')).toThrow(/UNIQUE/);
  expect(() => db.prepare(named).run(null)).toThrow(/UNIQUE/);
  expect(db.prepare(named).run('cart').changes).toBe(1);
});
