import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { Carnet, MEMORY_DB, openDatabase, REPORTING_NOTE, STOPPED_NOTE } from '../src/index.ts';
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
  const group = {
    root,
    name: 'g',
    repos: [join(root, 'api')],
    hosts: ['claude-code'],
    dbPath: MEMORY_DB,
  };
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
  expect(carnet.agents.get(SESSION, 'bravo')?.hostAgentId).toBe('id-b');
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

test('a stop publishes a finished agent once and leaves unknown agents alone', () => {
  const { carnet } = setup();
  carnet.agents.start(SESSION, { name: 'good', task: 't' });
  carnet.agents.pairSubagent(SESSION, 'id-g');
  carnet.agents.finish(SESSION, 'good', { reportPath: '/r.md', hasQuestions: false });
  expect(carnet.agents.stopSubagent(SESSION, 'id-g')?.status).toBe('review');
  expect(carnet.agents.stopSubagent(SESSION, 'id-g')).toBeUndefined();
  expect(carnet.agents.stopSubagent(SESSION, 'id-none')).toBeUndefined();
  expect(carnet.agents.get(SESSION, 'good')).toMatchObject({ status: 'review', note: null });
});

function pairedAgent() {
  const context = setup();
  context.carnet.agents.start(SESSION, { name: 'fork', task: 'task' });
  context.carnet.agents.pairSubagent(SESSION, 'id-fork');
  context.carnet.agents.finish(SESSION, 'fork', { reportPath: '/r.md', hasQuestions: true });
  return context;
}

function finishedEvents(carnet: Carnet) {
  return carnet.events.read(SESSION, 50).filter((event) => event.type === 'finished');
}

test('agent_done on a paired fork waits for SubagentStop to publish', () => {
  const { carnet } = pairedAgent();
  expect(carnet.agents.get(SESSION, 'fork')).toMatchObject({
    status: 'running',
    note: REPORTING_NOTE,
    pendingStatus: 'answer',
    reportPath: '/r.md',
  });
  expect(finishedEvents(carnet)).toEqual([]);
  carnet.agents.stopSubagent(SESSION, 'id-fork');
  expect(carnet.agents.get(SESSION, 'fork')).toMatchObject({
    status: 'answer',
    note: null,
    pendingStatus: null,
  });
  expect(finishedEvents(carnet).map((event) => event.link)).toEqual(['/r.md']);
});

test('agent_done on an unpaired agent publishes at once', () => {
  const { carnet } = setup();
  carnet.agents.start(SESSION, { name: 'solo', task: 'task' });
  carnet.agents.finish(SESSION, 'solo', { reportPath: '/s.md', hasQuestions: false });
  expect(carnet.agents.get(SESSION, 'solo')).toMatchObject({ status: 'review', note: null });
  expect(finishedEvents(carnet)).toHaveLength(1);
});

test("main's agent_update publishes the pending outcome first", () => {
  const { carnet } = pairedAgent();
  const updated = carnet.agents.update(SESSION, 'fork', {
    status: 'answer',
    reportPath: '/final.md',
  });
  expect(updated).toMatchObject({ status: 'answer', pendingStatus: null, reportPath: '/final.md' });
  expect(finishedEvents(carnet)).toHaveLength(1);
  carnet.agents.stopSubagent(SESSION, 'id-fork');
  expect(finishedEvents(carnet)).toHaveLength(1);
});

test('a pending outcome is published on read after the fallback delay', () => {
  const { carnet, clock } = pairedAgent();
  clock.advance(119_000);
  expect(carnet.agents.get(SESSION, 'fork')?.status).toBe('running');
  clock.advance(2_000);
  expect(carnet.agents.list(SESSION).map((agent) => agent.status)).toEqual(['answer']);
  expect(finishedEvents(carnet)).toHaveLength(1);
});

test('the status view shows a reporting fork as running with its note', () => {
  const { carnet } = pairedAgent();
  expect(carnet.status.render(carnet.sessions.require(SESSION))).toContain(
    `fork — ${REPORTING_NOTE}`,
  );
});
