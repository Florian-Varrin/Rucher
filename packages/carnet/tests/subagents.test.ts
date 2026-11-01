import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { Carnet, MEMORY_DB, openDatabase, STOPPED_NOTE } from '../src/index.ts';
import { SESSION, tempDirectory } from './helpers.ts';

function setup() {
  let time = Date.parse('2026-11-01T10:00:00.000Z');
  const clock = {
    now: () => new Date(time),
    advance: (milliseconds: number) => {
      time += milliseconds;
    },
  };
  const root = tempDirectory();
  mkdirSync(join(root, 'api'));
  const group = { root, name: 'g', repos: [join(root, 'api')], dbPath: MEMORY_DB };
  const carnet = new Carnet(group, openDatabase(MEMORY_DB), { now: clock.now });
  carnet.sessions.upsertFromHook({ session_id: SESSION, cwd: root, source: 'startup' });
  return { carnet, clock };
}

test('pairs subagents with running agents in start order, once', () => {
  const { carnet, clock } = setup();
  for (const name of ['alpha', 'bravo', 'charlie']) {
    carnet.agents.start(SESSION, { name, task: name });
  }
  clock.advance(500);
  expect(carnet.agents.pairSubagent(SESSION, 'id-a')?.name).toBe('alpha');
  expect(carnet.agents.pairSubagent(SESSION, 'id-b')?.name).toBe('bravo');
  expect(carnet.agents.pairSubagent(SESSION, 'id-a')?.name).toBe('alpha');
  expect(carnet.agents.pairSubagent(SESSION, 'id-c')?.name).toBe('charlie');
  expect(carnet.agents.pairSubagent(SESSION, 'id-d')).toBeUndefined();
  expect(carnet.agents.get(SESSION, 'bravo')?.claudeAgentId).toBe('id-b');
});

test('ignores agents started outside the pairing window or not running', () => {
  const { carnet, clock } = setup();
  carnet.agents.start(SESSION, { name: 'old', task: 'old' });
  clock.advance(61_000);
  carnet.agents.start(SESSION, { name: 'answered', task: 't' });
  carnet.agents.update(SESSION, 'answered', { status: 'answer' });
  expect(carnet.agents.pairSubagent(SESSION, 'id-x')).toBeUndefined();
  carnet.agents.start(SESSION, { name: 'fresh', task: 't' });
  expect(carnet.agents.pairSubagent(SESSION, 'id-x')?.name).toBe('fresh');
});

test('a stop moves a paired agent still running to review and logs it', () => {
  const { carnet } = setup();
  carnet.agents.start(SESSION, { name: 'lost', task: 't' });
  carnet.agents.update(SESSION, 'lost', { status: 'running', note: 'halfway' });
  carnet.agents.pairSubagent(SESSION, 'id-l');
  expect(carnet.agents.stopSubagent(SESSION, 'id-l')).toMatchObject({
    status: 'review',
    note: STOPPED_NOTE,
  });
  expect(carnet.events.read(SESSION).at(-1)).toMatchObject({
    type: 'finished',
    agent: 'lost',
    note: STOPPED_NOTE,
  });
  expect(carnet.agents.stopSubagent(SESSION, 'id-l')).toBeUndefined();
});

test('a stop leaves finished and unknown agents alone', () => {
  const { carnet } = setup();
  carnet.agents.start(SESSION, { name: 'good', task: 't' });
  carnet.agents.pairSubagent(SESSION, 'id-g');
  carnet.agents.finish(SESSION, 'good', { reportPath: '/r.md', hasQuestions: false });
  expect(carnet.agents.stopSubagent(SESSION, 'id-g')).toBeUndefined();
  expect(carnet.agents.stopSubagent(SESSION, 'id-none')).toBeUndefined();
  expect(carnet.agents.get(SESSION, 'good')).toMatchObject({ status: 'review', note: null });
});
