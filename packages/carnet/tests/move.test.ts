import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vite-plus/test';
import { Carnet, type CarnetError, MEMORY_DB, moveSession, openDatabase } from '../src/index.ts';
import { workspaceAt, makeClock, SESSION, tempDirectory } from './helpers.ts';

function shopWorkspace(db: DatabaseSync, name: string): Carnet {
  const root = tempDirectory(`${name}-`);
  return new Carnet(db, workspaceAt(root, name, [join(root, 'shop-api')]), { now: makeClock() });
}

function strayShopSession(): { source: Carnet; target: Carnet } {
  const db = openDatabase(MEMORY_DB);
  const source = shopWorkspace(db, 'shop-mobile');
  const target = shopWorkspace(db, 'shop');
  source.sessions.create({ id: SESSION, kind: 'active', name: 'shop-auth', cwd: '/shop' });
  source.agents.start(SESSION, { name: 'login-form', task: 'Add the login form' });
  source.agents.start(SESSION, { name: 'cart-badge', task: 'Show the cart count' });
  source.events.log(SESSION, { type: 'answered', agent: 'login-form' });
  source.table.set(SESSION, { text: 'Review login-form', mainWorking: true });
  source.notes.add({
    kind: 'learning',
    text: 'The cart api caches for a minute',
    session: SESSION,
  });
  return { source, target };
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return (error as CarnetError).code;
  }
}

test('moves a session to another workspace with its agents, journal and table line, notes stay', () => {
  const { source, target } = strayShopSession();
  const result = moveSession(source, SESSION, 'shop');
  expect(result).toMatchObject({
    into: null,
    movedAgents: ['login-form', 'cart-badge'],
    skippedAgents: [],
    movedTable: true,
    keptNotes: 1,
  });
  expect(result.movedEvents).toBeGreaterThanOrEqual(1);
  expect(target.sessions.byName('shop-auth')?.id).toBe(SESSION);
  expect(target.agents.list(SESSION)).toHaveLength(2);
  expect(target.events.read(SESSION).length).toBe(result.movedEvents);
  expect(target.table.get(SESSION)?.text).toBe('Review login-form');
  expect(source.sessions.list()).toEqual([]);
  expect(source.notes.list().map((note) => note.text)).toEqual([
    'The cart api caches for a minute',
  ]);
  expect(target.notes.list()).toEqual([]);
});

test('a dry run changes nothing', () => {
  const { source, target } = strayShopSession();
  const result = moveSession(source, SESSION, 'shop', { dryRun: true });
  expect(result.movedAgents).toHaveLength(2);
  expect(source.sessions.byName('shop-auth')?.id).toBe(SESSION);
  expect(target.sessions.list()).toEqual([]);
});

test('a name taken in the target refuses the move, --merge joins them', () => {
  const { source, target } = strayShopSession();
  const other = 'bb9b338a-c4a7-4b3a-82d0-fc16193a7749';
  target.sessions.create({ id: other, kind: 'active', name: 'shop-auth', cwd: '/shop' });
  target.agents.start(other, { name: 'login-form', task: 'Add the login form' });
  target.table.set(other, { text: 'Test cart-badge', mainWorking: false });
  expect(codeOf(() => moveSession(source, SESSION, 'shop'))).toBe('SESSION_NAME_TAKEN');
  const result = moveSession(source, SESSION, 'shop', { merge: true });
  expect(result).toMatchObject({
    movedAgents: ['cart-badge'],
    skippedAgents: ['login-form'],
    movedTable: false,
  });
  expect(result.into?.id).toBe(other);
  expect(target.agents.list(other)).toHaveLength(2);
  expect(target.table.get(other)?.text).toBe('Test cart-badge');
  expect(source.sessions.list({ includeArchived: true, includeTemp: true })).toEqual([]);
});

test('a session cannot move into its own workspace', () => {
  const { source } = strayShopSession();
  expect(codeOf(() => moveSession(source, SESSION, 'shop-mobile'))).toBe('SESSION_MOVE_INVALID');
});
