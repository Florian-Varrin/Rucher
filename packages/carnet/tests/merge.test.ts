import { expect, test } from 'vite-plus/test';
import type { CarnetError } from '../src/index.ts';
import { makeCarnet, SESSION } from './helpers.ts';

const PROVISIONAL = 'a634d82e-3715-494b-815e-b84d7fb2f142';

function split() {
  const made = makeCarnet();
  const { carnet, root } = made;
  carnet.sessions.upsertFromHook({ session_id: SESSION, cwd: root, source: 'startup' });
  carnet.sessions.ensure(PROVISIONAL, root);
  carnet.agents.start(SESSION, { name: 'shared', task: 'kept' });
  carnet.agents.start(PROVISIONAL, { name: 'shared', task: 'duplicate' });
  carnet.agents.start(PROVISIONAL, { name: 'moved', task: 'task' });
  carnet.table.set(PROVISIONAL, { text: 'review moved', mainWorking: false, status: 'review' });
  return made;
}

test('merge moves agents, events and the table line, then drops the source', () => {
  const { carnet } = split();
  carnet.sessions.name(PROVISIONAL, 'shop-auth', 'Login flow');
  const result = carnet.sessions.merge(PROVISIONAL, SESSION);
  expect(result).toMatchObject({
    movedAgents: ['moved'],
    closedAgents: ['shared'],
    movedEvents: 2,
    movedTable: true,
  });
  expect(result.session).toMatchObject({
    name: 'shop-auth',
    purpose: 'Login flow',
    kind: 'active',
  });
  expect(
    carnet.agents
      .list(SESSION)
      .map((agent) => agent.name)
      .sort(),
  ).toEqual(['moved', 'shared']);
  expect(carnet.agents.get(SESSION, 'shared')?.task).toBe('kept');
  expect(carnet.agents.list(PROVISIONAL)).toEqual([]);
  expect(carnet.table.get(SESSION)?.text).toBe('review moved');
  expect(carnet.events.read(SESSION, 20).map((event) => event.agent)).toEqual([
    'shared',
    'shared',
    'moved',
  ]);
  expect(carnet.sessions.get(PROVISIONAL)).toMatchObject({ status: 'archived', name: null });
});

test('merge keeps the target table line and name when it has them', () => {
  const { carnet } = split();
  carnet.table.set(SESSION, { text: 'own line', mainWorking: true });
  carnet.sessions.name(SESSION, 'main-name');
  carnet.sessions.name(PROVISIONAL, 'other-name');
  const result = carnet.sessions.merge(PROVISIONAL, SESSION);
  expect(result.movedTable).toBe(false);
  expect(result.session.name).toBe('main-name');
  expect(carnet.table.get(SESSION)?.text).toBe('own line');
  expect(carnet.table.get(PROVISIONAL)).toBeUndefined();
});

test('merge refuses itself and unknown sessions', () => {
  const { carnet } = split();
  const codeOf = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      return (error as CarnetError).code;
    }
    return 'none';
  };
  expect(codeOf(() => carnet.sessions.merge(SESSION, SESSION))).toBe('SESSION_MERGE_INVALID');
  expect(codeOf(() => carnet.sessions.merge('missing', SESSION))).toBe('SESSION_NOT_FOUND');
  expect(codeOf(() => carnet.sessions.merge(PROVISIONAL, 'missing'))).toBe('SESSION_NOT_FOUND');
  expect(carnet.agents.list(PROVISIONAL)).toHaveLength(2);
});
