import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import {
  addGroupRepo,
  Carnet,
  type CarnetError,
  initGroup,
  MEMORY_DB,
  memoryHalfLife,
  migrations,
  openDatabase,
  schemaVersion,
  similarity,
} from '../src/index.ts';
import { tempDirectory } from './helpers.ts';

const SESSION = '0360889d-99c7-4c8f-8447-50ce30696e5a';
const OTHER = '9f2c6a10-0000-4000-8000-000000000001';

function shop(start = '2026-11-03T09:00:00') {
  const root = tempDirectory();
  for (const repo of ['shop-api', 'shop-web']) mkdirSync(join(root, repo));
  let now = new Date(start);
  const group = {
    root,
    name: 'shop',
    repos: [join(root, 'shop-api'), join(root, 'shop-web')],
    hosts: ['claude-code'],
    dbPath: MEMORY_DB,
  };
  const carnet = new Carnet(group, openDatabase(MEMORY_DB), { now: () => now });
  carnet.sessions.upsertFromHook({ session_id: SESSION, cwd: root, source: 'startup' });
  const advanceDays = (days: number) => {
    now = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  };
  return { carnet, root, advanceDays };
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as CarnetError).code;
  }
  return undefined;
}

test('a note is added with its repos, general when none', () => {
  const { carnet } = shop();
  const { note, similar } = carnet.notes.add({
    kind: 'learning',
    text: 'the tests need REDIS_URL, even the unit tests',
    repos: ['shop-api'],
    session: SESSION,
    agent: 'banner',
  });
  expect(note).toMatchObject({
    id: 1,
    kind: 'learning',
    repos: ['shop-api'],
    session: SESSION,
    agent: 'banner',
    droppedAt: null,
  });
  expect(similar).toEqual([]);
  const general = carnet.notes.add({
    kind: 'decision',
    text: 'auth stays in sessions: SSO needs cookies',
  });
  expect(general.note.repos).toEqual([]);
  expect(carnet.notes.list({ general: true }).map((listed) => listed.id)).toEqual([
    general.note.id,
  ]);
  expect(carnet.notes.list({ repo: 'shop-api' }).map((listed) => listed.id)).toEqual([note.id]);
});

test('note text, kind and repos are validated', () => {
  const { carnet } = shop();
  const add =
    (text: string, repos?: string[], kind = 'learning') =>
    () =>
      carnet.notes.add({ kind, text, repos });
  expect(codeOf(add('x'.repeat(200)))).toBe('INVALID_NOTE');
  expect(codeOf(add('use `pnpm test` here'))).toBe('INVALID_NOTE');
  expect(codeOf(add('**bold** claim'))).toBe('INVALID_NOTE');
  expect(codeOf(add('- a list item'))).toBe('INVALID_NOTE');
  expect(codeOf(add('see [the doc](https://example.com)'))).toBe('INVALID_NOTE');
  expect(codeOf(add('two\nlines'))).toBe('INVALID_NOTE');
  expect(codeOf(add('   '))).toBe('INVALID_NOTE');
  expect(codeOf(add('fine', ['shop-infra']))).toBe('INVALID_NOTE');
  expect(codeOf(add('fine', [], 'idea'))).toBe('INVALID_NOTE');
  expect(codeOf(add('x'.repeat(199)))).toBeUndefined();
});

test('a near duplicate is still added, with the similar notes as a warning kept on the note', () => {
  const { carnet } = shop();
  const first = carnet.notes.add({
    kind: 'dead_end',
    text: 'sessions on Workers: the cold start breaks the SSR cache',
  });
  carnet.notes.add({
    kind: 'learning',
    text: 'sessions on Workers: the cold start breaks the SSR cache',
  });
  const second = carnet.notes.add({
    kind: 'dead_end',
    text: 'sessions on Workers: cold start breaks the SSR cache',
  });
  expect(second.similar.map((note) => note.id)).toEqual([first.note.id]);
  expect(carnet.notes.get(second.note.id)?.similarNotes).toEqual([first.note.id]);
  expect(similarity('a b c', 'x y z')).toBe(0);
  expect(similarity('Workers cold start', 'workers, cold start!')).toBe(1);
});

test('list filters by kind and substring, orders dead ends, decisions, learnings by weight', () => {
  const { carnet } = shop();
  const learning = carnet.notes.add({ kind: 'learning', text: 'the build needs Node 24' }).note;
  const decision = carnet.notes.add({
    kind: 'decision',
    text: 'keep SQLite: one file per group',
  }).note;
  const deadEnd = carnet.notes.add({
    kind: 'dead_end',
    text: 'a daemon was too much to install',
  }).note;
  const cited = carnet.notes.add({ kind: 'learning', text: 'the lint is type aware' }).note;
  carnet.notes.cite(cited.id, { why: 'ran the type check first', session: SESSION });
  expect(carnet.notes.list().map((note) => note.id)).toEqual([
    deadEnd.id,
    decision.id,
    cited.id,
    learning.id,
  ]);
  expect(carnet.notes.list({ kind: 'decision' }).map((note) => note.id)).toEqual([decision.id]);
  expect(carnet.notes.list({ query: 'NODE' }).map((note) => note.id)).toEqual([learning.id]);
  expect(carnet.notes.list({ query: '100%' })).toEqual([]);
});

test('drop keeps the note with its reason, replacement and session', () => {
  const { carnet } = shop();
  const old = carnet.notes.add({ kind: 'learning', text: 'the cache key is per user' }).note;
  const replacement = carnet.notes.add({
    kind: 'learning',
    text: 'the cache key is per tenant',
  }).note;
  expect(codeOf(() => carnet.notes.drop(old.id, { reason: ' ' }))).toBe('INVALID_NOTE');
  expect(codeOf(() => carnet.notes.drop(old.id, { reason: 'wrong', replacedBy: old.id }))).toBe(
    'INVALID_NOTE',
  );
  expect(codeOf(() => carnet.notes.drop(old.id, { reason: 'wrong', replacedBy: 99 }))).toBe(
    'NOTE_NOT_FOUND',
  );
  const dropped = carnet.notes.drop(old.id, {
    reason: 'the key is per tenant',
    replacedBy: replacement.id,
    session: SESSION,
  });
  expect(dropped).toMatchObject({
    droppedReason: 'the key is per tenant',
    droppedSession: SESSION,
    replacedBy: replacement.id,
  });
  expect(dropped.droppedAt).not.toBeNull();
  expect(carnet.notes.list().map((note) => note.id)).toEqual([replacement.id]);
  expect(carnet.notes.list({ includeDropped: true })).toHaveLength(2);
  expect(codeOf(() => carnet.notes.drop(old.id, { reason: 'again' }))).toBe('INVALID_NOTE');
  expect(codeOf(() => carnet.notes.cite(old.id, { why: 'too late' }))).toBe('INVALID_NOTE');
});

test('a citation needs a reason and counts once per session', () => {
  const { carnet } = shop();
  carnet.sessions.upsertFromHook({ session_id: OTHER, source: 'startup' });
  const note = carnet.notes.add({ kind: 'dead_end', text: 'the Workers migration failed' }).note;
  expect(codeOf(() => carnet.notes.cite(note.id, { why: '' }))).toBe('INVALID_NOTE');
  expect(codeOf(() => carnet.notes.cite(42, { why: 'x' }))).toBe('NOTE_NOT_FOUND');
  carnet.notes.cite(note.id, { why: 'avoided the migration', session: SESSION });
  carnet.notes.cite(note.id, { why: 'avoided it again', session: SESSION });
  carnet.notes.cite(note.id, { why: 'kept the old runtime', session: OTHER, agent: 'banner' });
  const detail = carnet.notes.show(note.id);
  expect(detail.citations.map((citation) => citation.why)).toEqual([
    'avoided the migration',
    'avoided it again',
    'kept the old runtime',
  ]);
  expect(detail.citationCount).toBe(3);
  expect(detail.weight).toBe(2);
});

test('weight decays with active days only, stale notes are listed after 40 active days', () => {
  const { carnet, advanceDays } = shop();
  carnet.notes.recordActiveDay();
  const cited = carnet.notes.add({ kind: 'learning', text: 'the API answers in UTC' }).note;
  const unused = carnet.notes.add({ kind: 'learning', text: 'the web build is slow' }).note;
  carnet.notes.cite(cited.id, { why: 'stored dates in UTC', session: SESSION });
  advanceDays(60);
  expect(carnet.notes.show(cited.id).weight).toBe(1);
  expect(carnet.notes.stale()).toEqual([]);
  for (let day = 0; day < 20; day++) {
    advanceDays(1);
    carnet.notes.recordActiveDay();
  }
  carnet.notes.recordActiveDay();
  expect(carnet.notes.show(cited.id).weight).toBeCloseTo(0.5);
  expect(carnet.notes.show(cited.id, 10).weight).toBeCloseTo(0.25);
  for (let day = 0; day < 21; day++) {
    advanceDays(1);
    carnet.notes.recordActiveDay();
  }
  expect(carnet.notes.stale().map((note) => note.id)).toEqual([unused.id]);
  expect(memoryHalfLife('7')).toBe(7);
  expect(memoryHalfLife('0')).toBe(20);
  expect(memoryHalfLife(undefined)).toBe(20);
});

test('notes and citations outlive a purged session', () => {
  const { carnet, advanceDays } = shop();
  carnet.sessions.upsertFromHook({ session_id: OTHER, source: 'startup' });
  const note = carnet.notes.add({
    kind: 'learning',
    text: 'the queue retries twice',
    session: OTHER,
  }).note;
  carnet.notes.cite(note.id, { why: 'set one retry less', session: OTHER });
  advanceDays(10);
  expect(carnet.sessions.purge(SESSION, 3)).toEqual([OTHER]);
  expect(carnet.notes.get(note.id)?.session).toBeNull();
  expect(carnet.notes.show(note.id).citations[0]?.session).toBeNull();
});

test('an existing version 6 database gains the memory tables and keeps its rows', () => {
  const path = join(tempDirectory(), 'carnet.db');
  const old = new DatabaseSync(path);
  for (const migration of migrations.slice(0, 6)) old.exec(migration);
  old.exec('PRAGMA user_version = 6');
  old.exec(
    "INSERT INTO sessions (id, status, created_at, last_active_at) VALUES ('s', 'active', 'x', 'x')",
  );
  old.close();
  const db = openDatabase(path);
  expect(schemaVersion(db)).toBe(migrations.length);
  expect(db.prepare('SELECT id FROM sessions').all()).toEqual([{ id: 's' }]);
  expect(db.prepare('SELECT COUNT(*) AS count FROM notes').get()).toEqual({ count: 0 });
  db.close();
});

test('a group cannot hold two repos with the same name', () => {
  const root = tempDirectory();
  for (const path of ['a/shop-api', 'b/shop-api', 'shop-web']) {
    mkdirSync(join(root, path), { recursive: true });
  }
  const env = { RUCHER_HOME: join(root, 'home') };
  const meta = join(root, 'meta');
  mkdirSync(meta);
  expect(
    codeOf(() =>
      initGroup(meta, { env, repos: [join(root, 'a/shop-api'), join(root, 'b/shop-api')] }),
    ),
  ).toBe('REPO_NAME_TAKEN');
  initGroup(meta, { env, repos: [join(root, 'a/shop-api')] });
  expect(codeOf(() => addGroupRepo(meta, join(root, 'b/shop-api')))).toBe('REPO_NAME_TAKEN');
  expect(addGroupRepo(meta, join(root, 'a/shop-api')).repos).toHaveLength(1);
  expect(addGroupRepo(meta, join(root, 'shop-web')).repos).toHaveLength(2);
});

test('sessionNoteActivity lists what a session added, cited and dropped, most recent first', () => {
  const { carnet, advanceDays } = shop();
  carnet.sessions.ensure(OTHER);
  const old = carnet.notes.add({
    kind: 'decision',
    text: 'auth stays in session: SSO partners need cookies',
    session: OTHER,
  });
  advanceDays(1);
  const first = carnet.notes.add({
    kind: 'dead_end',
    text: 'SSR cache keyed per tenant: too wide, leaks between tenants',
    session: SESSION,
  });
  advanceDays(1);
  const second = carnet.notes.add({
    kind: 'dead_end',
    text: 'SSR cache keyed per tenant: too wide, leaks across tenants',
    session: SESSION,
  });
  advanceDays(1);
  carnet.notes.cite(old.note.id, { why: 'kept the cookie session', session: SESSION });
  advanceDays(1);
  carnet.notes.drop(first.note.id, {
    reason: 'reworded',
    replacedBy: second.note.id,
    session: SESSION,
  });

  const activity = carnet.notes.activity(SESSION);
  expect(activity.map((item) => [item.activity, item.note])).toEqual([
    ['dropped', first.note.id],
    ['cited', old.note.id],
    ['added', second.note.id],
    ['added', first.note.id],
  ]);
  expect(activity[0]).toMatchObject({ replacedBy: second.note.id, text: 'reworded' });
  expect(activity[1]).toMatchObject({ kind: 'decision', text: 'kept the cookie session' });
  expect(activity[2]?.similarNotes).toEqual([]);
  expect(carnet.notes.activity(OTHER).map((item) => item.activity)).toEqual(['added']);
});

test('a possible duplicate stops showing once the similar note is dropped', () => {
  const { carnet } = shop();
  const first = carnet.notes.add({
    kind: 'dead_end',
    text: 'tenant SSR cache: key too wide, leaks between tenants',
    session: SESSION,
  });
  const second = carnet.notes.add({
    kind: 'dead_end',
    text: 'tenant SSR cache: key too wide, leaks across tenants',
    session: SESSION,
  });
  expect(
    carnet.notes.activity(SESSION).find((item) => item.note === second.note.id)?.similarNotes,
  ).toEqual([first.note.id]);
  carnet.notes.drop(first.note.id, { reason: 'duplicate' });
  expect(
    carnet.notes.activity(SESSION).find((item) => item.note === second.note.id)?.similarNotes,
  ).toEqual([]);
});
