import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import {
  archiveGroupSessions,
  Carnet,
  type CarnetError,
  MEMORY_DB,
  migrate,
  migrations,
  openDatabase,
  renameGroupRows,
  sessionGroupName,
} from '../src/index.ts';
import { groupAt, makeClock, tempDirectory } from './helpers.ts';

const SHOP = '0360889d-99c7-4c8f-8447-50ce30696e5a';
const BLOG = 'bb9b338a-c4a7-4b3a-82d0-fc16193a7749';
const LOOSE = 'c41d2e6a-7f0e-4a52-9a43-1b6f4b1f2a10';

function groupCarnet(db: DatabaseSync, name: string | null): Carnet {
  if (name === null) return new Carnet(db, null, { now: makeClock() });
  const root = tempDirectory(`${name}-`);
  return new Carnet(db, groupAt(root, name, [join(root, 'api')]), { now: makeClock() });
}

function twoGroups() {
  const db = openDatabase(MEMORY_DB);
  return { db, shop: groupCarnet(db, 'shop'), blog: groupCarnet(db, 'blog') };
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return (error as CarnetError).code;
  }
}

test('groups sharing one database only see their own sessions', () => {
  const { shop, blog } = twoGroups();
  shop.sessions.create({ id: SHOP, kind: 'active', name: 'auth', cwd: '/shop' });
  blog.sessions.create({ id: BLOG, kind: 'active', name: 'auth', cwd: '/blog' });
  expect(shop.sessions.list().map((session) => session.id)).toEqual([SHOP]);
  expect(blog.sessions.byName('auth')?.id).toBe(BLOG);
  expect(shop.sessions.default()?.id).toBe(SHOP);
  expect(shop.sessions.find('auth').groupName).toBe('shop');
  expect(codeOf(() => shop.sessions.find(BLOG.slice(0, 6)))).toBe('SESSION_NOT_FOUND');
});

test('session names stay unique among sessions without a group', () => {
  const db = openDatabase(MEMORY_DB);
  const loose = groupCarnet(db, null);
  loose.sessions.create({ id: LOOSE, kind: 'active', name: 'scratch', cwd: '/tmp' });
  expect(
    codeOf(() => loose.sessions.create({ id: SHOP, kind: 'active', name: 'scratch', cwd: '/' })),
  ).toBe('SESSION_NAME_TAKEN');
  groupCarnet(db, 'shop').sessions.create({ id: BLOG, kind: 'active', name: 'scratch', cwd: '/' });
  expect(loose.sessions.list().map((session) => session.groupName)).toEqual([null]);
  expect(codeOf(() => loose.notes.add({ kind: 'learning', text: 'No group here' }))).toBe(
    'NO_GROUP',
  );
});

test('note numbers start at 1 in each group and drive drop, cite and replacement', () => {
  const { shop, blog } = twoGroups();
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

test('active days are counted per group', () => {
  const { db, shop, blog } = twoGroups();
  shop.notes.recordActiveDay();
  blog.notes.recordActiveDay();
  const days = db.prepare('SELECT group_name FROM active_days ORDER BY group_name').all();
  expect(days.map((row) => row.group_name)).toEqual(['blog', 'shop']);
});

test('the seams resolve, rename and archive a group by name', () => {
  const { db, shop } = twoGroups();
  shop.sessions.create({ id: SHOP, kind: 'active', name: 'auth', cwd: '/shop' });
  shop.agents.start(SHOP, { name: 'cart', task: 'Show the cart' });
  shop.notes.add({ kind: 'learning', text: 'The cart caches for a minute' });
  shop.notes.recordActiveDay();
  expect(sessionGroupName(db, SHOP)).toBe('shop');
  expect(sessionGroupName(db, BLOG)).toBeUndefined();
  renameGroupRows(db, 'shop', 'store');
  const store = groupCarnet(db, 'store');
  expect(store.sessions.byName('auth')?.id).toBe(SHOP);
  expect(store.notes.list()).toHaveLength(1);
  expect(archiveGroupSessions(db, 'store', '2026-11-03T10:00:00.000Z')).toBe(1);
  expect(store.sessions.require(SHOP).status).toBe('archived');
  expect(store.agents.get(SHOP, 'cart')?.status).toBe('closed');
});

test('v9 keeps the rows of a v8 database, under the empty group name', () => {
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
  expect(sessionGroupName(db, SHOP)).toBe('');
  expect(db.prepare('SELECT group_name, number FROM notes').get()).toEqual({
    group_name: '',
    number: 1,
  });
  expect(db.prepare('SELECT group_name, day FROM active_days').get()).toEqual({
    group_name: '',
    day: '2026-11-01',
  });
});
