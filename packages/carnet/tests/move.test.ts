import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { Carnet, type CarnetError, MEMORY_DB, moveSession, openDatabase } from '../src/index.ts';
import { makeClock, SESSION, tempDirectory } from './helpers.ts';

function shopGroup(name: string): Carnet {
  const root = tempDirectory(`${name}-`);
  const group = {
    root,
    name,
    repos: [join(root, 'shop-api')],
    hosts: ['claude-code'],
    dbPath: MEMORY_DB,
  };
  return new Carnet(group, openDatabase(MEMORY_DB), { now: makeClock() });
}

function strayShopSession(): { source: Carnet; target: Carnet } {
  const source = shopGroup('shop-mobile');
  const target = shopGroup('shop');
  source.sessions.create({
    id: SESSION,
    kind: 'active',
    name: 'shop-auth',
    cwd: source.group.root,
  });
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

test('moves a session with its agents, journal and table line, notes stay', () => {
  const { source, target } = strayShopSession();
  const result = moveSession(source, SESSION, target);
  expect(result).toMatchObject({
    into: null,
    movedAgents: ['login-form', 'cart-badge'],
    skippedAgents: [],
    movedTable: true,
    unlinkedNotes: 1,
  });
  expect(result.movedEvents).toBeGreaterThanOrEqual(3);
  expect(target.sessions.require(SESSION)).toMatchObject({ name: 'shop-auth', kind: 'active' });
  expect(
    target.agents
      .list(SESSION)
      .map((agent) => agent.name)
      .sort(),
  ).toEqual(['cart-badge', 'login-form'].sort());
  expect(target.events.read(SESSION).length).toBe(result.movedEvents);
  expect(target.table.get(SESSION)?.text).toBe('Review login-form');
  expect(source.sessions.get(SESSION)).toBeUndefined();
  expect(source.notes.list().map((note) => [note.text, note.session])).toEqual([
    ['The cart api caches for a minute', null],
  ]);
  expect(target.notes.list()).toEqual([]);
});

test('a dry run changes nothing', () => {
  const { source, target } = strayShopSession();
  const result = moveSession(source, SESSION, target, { dryRun: true });
  expect(result.movedAgents).toHaveLength(2);
  expect(source.agents.list(SESSION)).toHaveLength(2);
  expect(target.sessions.get(SESSION)).toBeUndefined();
});

test('a target that has the session refuses the move, --merge joins them', () => {
  const { source, target } = strayShopSession();
  target.sessions.create({
    id: SESSION,
    kind: 'active',
    name: 'shop-auth',
    cwd: target.group.root,
  });
  target.agents.start(SESSION, { name: 'login-form', task: 'Add the login form' });
  target.table.set(SESSION, { text: 'Test cart-badge', mainWorking: false });
  expect(codeOf(() => moveSession(source, SESSION, target))).toBe('SESSION_EXISTS');
  const result = moveSession(source, SESSION, target, { merge: true });
  expect(result).toMatchObject({
    movedAgents: ['cart-badge'],
    skippedAgents: ['login-form'],
    movedTable: false,
  });
  expect(result.into?.id).toBe(SESSION);
  expect(target.agents.list(SESSION)).toHaveLength(2);
  expect(target.table.get(SESSION)?.text).toBe('Test cart-badge');
  expect(source.sessions.get(SESSION)).toBeUndefined();
});

test('a name taken in the target refuses the move, and a group cannot move into itself', () => {
  const { source, target } = strayShopSession();
  target.sessions.create({
    id: 'bb9b338a-c4a7-4b3a-82d0-fc16193a7749',
    kind: 'active',
    name: 'shop-auth',
    cwd: target.group.root,
  });
  expect(codeOf(() => moveSession(source, SESSION, target))).toBe('SESSION_NAME_TAKEN');
  expect(codeOf(() => moveSession(source, SESSION, source))).toBe('SESSION_MOVE_INVALID');
});
