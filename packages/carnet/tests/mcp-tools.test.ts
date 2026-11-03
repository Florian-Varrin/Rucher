import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { beforeAll, expect, test } from 'vite-plus/test';
import { type Carnet, CarnetError } from '../src/index.ts';
import { createCarnetServer, INSTRUCTIONS, TOOLS } from '../src/mcp/index.ts';
import { makeCarnet, SESSION } from './helpers.ts';

let carnet: Carnet;
let made: ReturnType<typeof makeCarnet>;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text?: string }[])
    .map((content) => content.text ?? '')
    .join('\n');
  return { text, isError: result.isError === true, structured: result.structuredContent };
}

beforeAll(async () => {
  made = makeCarnet();
  carnet = made.carnet;
  const server = createCarnetServer({
    carnet,
    env: { CLAUDE_CODE_SESSION_ID: SESSION },
    cwd: made.root,
    ppid: 1,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
});

test("instructions fit Claude Code's limit and tools are listed", async () => {
  expect(INSTRUCTIONS.length).toBeLessThan(4096);
  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name).sort()).toEqual(TOOLS.map((tool) => tool.name).sort());
  const start = tools.find((tool) => tool.name === 'agent_start');
  expect(start?.inputSchema).toMatchObject({ type: 'object', required: ['name', 'task'] });
});

test('main and fork lifecycle through the protocol', async () => {
  const started = await call('agent_start', { name: 'banner', task: 'Add banner' });
  const destination = join(made.root, 'reports', 'banner.md');
  expect(started.text).toBe(
    `⏳ banner started in group ${carnet.group?.name}\nReport destination: ${destination}`,
  );
  expect(started.structured).toBeUndefined();
  expect(existsSync(dirname(destination))).toBe(true);
  expect(
    (await call('agent_update', { name: 'banner', status: 'running', note: 'halfway' })).text,
  ).toBe('⏳ banner — halfway');
  expect(
    (
      await call('agent_done', {
        name: 'banner',
        report_path: '/tmp/banner.md',
        has_questions: true,
      })
    ).text,
  ).toBe('❓ banner needs answers');
  expect((await call('table_set', { text: 'Step 1 — applying', main_working: true })).text).toBe(
    '⚙️ Step 1 — applying (main working, not ready)',
  );
  expect(
    (await call('log_event', { type: 'committed', agent: 'banner', commit: 'abc123' })).text,
  ).toBe('logged committed banner abc123');

  await call('agent_update', {
    name: 'banner',
    status: 'answer',
    report_path: '/repo/forks/banner.md',
  });
  const list = await call('agent_list');
  expect(list.text).toBe('❓ banner [answer] (report: /repo/forks/banner.md)');

  expect((await call('agent_drop', { name: 'banner', reason: 'merged' })).text).toBe(
    'banner closed',
  );
  expect((await call('agent_list')).text).toBe('no open agents');
  expect((await call('table_clear')).text).toBe('On the table cleared');

  expect(carnet.events.read(SESSION).map((event) => event.type)).toEqual([
    'started',
    'finished',
    'committed',
    'dropped',
  ]);
  expect(carnet.sessions.get(SESSION)?.kind).toBe('temp');
});

test('queue_reorder reports the waiting order', async () => {
  await call('agent_start', { name: 'a', task: 't' });
  await call('agent_start', { name: 'b', task: 't' });
  await call('agent_done', { name: 'a', report_path: 'a.md', has_questions: false });
  await call('agent_done', { name: 'b', report_path: 'b.md', has_questions: true });
  expect((await call('queue_reorder', { names: ['a'] })).text).toBe('Waiting order: a, b');
});

test('carnet errors come back as tool errors, validation errors too', async () => {
  const dup = await call('agent_start', { name: 'a', task: 'again' });
  expect(dup.isError).toBe(true);
  expect(dup.text).toContain('AGENT_EXISTS');
  const bad = await call('table_set', { text: 'x', main_working: true, status: 'review' });
  expect(bad.isError).toBe(true);
  expect(bad.text).toContain('TABLE_STATUS_WITH_MAIN_WORKING');
  const invalid = await call('agent_update', { name: 'a', status: 'closed' });
  expect(invalid.isError).toBe(true);
  expect(invalid.text).toContain('Input validation error');
});

test('an explicit session targets another session by full id or id prefix', async () => {
  const otherId = '9cd374b8-9225-4ad8-8407-f38398966ed3';
  const other = await call('agent_start', { name: 'x', task: 't', session: otherId });
  expect(other.isError).toBe(false);
  const byPrefix = await call('agent_update', { name: 'x', status: 'review', session: '9cd374b8' });
  expect(byPrefix.isError).toBe(false);
  expect(carnet.agents.list(otherId).map((agent) => [agent.name, agent.status])).toEqual([
    ['x', 'review'],
  ]);
  const typo = await call('agent_list', { session: 'nope-session' });
  expect(typo.isError).toBe(true);
  expect(typo.text).toContain('SESSION_NOT_FOUND');
});

test('a lazy carnet that has no group answers NO_GROUP instead of failing to start', async () => {
  const server = createCarnetServer({
    carnet: () => {
      throw new CarnetError('NO_GROUP', 'no group here');
    },
    env: {},
    ppid: 1,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const lazyClient = new Client({ name: 'lazy', version: '0.0.0' });
  await lazyClient.connect(clientTransport);
  const result = await lazyClient.callTool({ name: 'agent_list', arguments: {} });
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result.content)).toContain('NO_GROUP');
});

test('notes through the protocol: add, duplicate warning, list, cite, drop', async () => {
  const added = await call('note_add', {
    kind: 'dead_end',
    text: 'sessions on Workers: the cold start breaks the SSR cache',
    repos: ['api'],
    agent: 'banner',
  });
  expect(added.text).toBe(
    'added #1 dead_end [api] sessions on Workers: the cold start breaks the SSR cache',
  );
  const duplicate = await call('note_add', {
    kind: 'dead_end',
    text: 'sessions on Workers: cold start breaks the SSR cache',
  });
  expect(duplicate.text).toContain('Similar active notes, possible duplicate:\n#1 dead_end');
  expect((await call('note_add', { kind: 'learning', text: 'x', repos: ['web'] })).isError).toBe(
    true,
  );
  expect((await call('note_list', { repo: 'api' })).text).toBe(
    '#1 dead_end [api] sessions on Workers: the cold start breaks the SSR cache',
  );
  expect((await call('note_cite', { id: 1, why: 'kept the old runtime' })).text).toBe(
    'cited #1: kept the old runtime',
  );
  expect(carnet.notes.show(1).citations[0]).toMatchObject({ session: SESSION });
  expect((await call('note_drop', { id: 2, reason: 'duplicate of #1', replaced_by: 1 })).text).toBe(
    'dropped #2, replaced by #1',
  );
  expect(carnet.notes.get(2)).toMatchObject({ droppedSession: SESSION });
  expect((await call('note_list', { include_dropped: true })).text).toContain(
    '(dropped: duplicate of #1)',
  );
  expect((await call('note_cite', { id: 9, why: 'nothing' })).isError).toBe(true);
});

test('agent_done copies the report to the group destination', async () => {
  await call('agent_start', { name: 'copied', task: 't' });
  const source = join(made.root, 'copied-scratch.md');
  writeFileSync(source, '# copied report');
  await call('agent_done', { name: 'copied', report_path: source, has_questions: false });
  const destination = join(made.root, 'reports', 'copied.md');
  expect(readFileSync(destination, 'utf8')).toBe('# copied report');
  expect(carnet.agents.get(SESSION, 'copied')?.reportPath).toBe(destination);
});

test('table_set keeps main_working when omitted, and a status clears it', async () => {
  await call('table_set', { text: 'shop fix', main_working: true });
  expect((await call('table_set', { text: 'shop fix, step 2' })).text).toContain('main working');
  expect(carnet.table.get(SESSION)?.mainWorking).toBe(true);
  await call('table_set', { text: 'shop fix', status: 'test' });
  expect(carnet.table.get(SESSION)).toMatchObject({ mainWorking: false, status: 'test' });
  await call('table_clear');
});

test('agent_step walks a fork from answers to commit in one call per step', async () => {
  await call('agent_start', { name: 'cart', task: 't' });
  await call('agent_done', { name: 'cart', report_path: 'cart.md', has_questions: true });
  expect((await call('agent_step', { name: 'cart', step: 'answered', note: 'yes' })).text).toBe(
    'logged answered · 📥 cart apply',
  );
  expect((await call('agent_step', { name: 'cart', step: 'applying' })).text).toBe(
    '⚙️ cart applying',
  );
  expect(carnet.table.get(SESSION)).toMatchObject({ text: 'cart applying', mainWorking: true });
  await call('agent_step', { name: 'cart', step: 'applied' });
  expect(carnet.agents.get(SESSION, 'cart')?.status).toBe('test');
  expect(carnet.table.get(SESSION)).toMatchObject({ status: 'test', mainWorking: false });
  await call('agent_step', { name: 'cart', step: 'tested' });
  expect(carnet.agents.get(SESSION, 'cart')?.status).toBe('commit');
  expect((await call('agent_step', { name: 'cart', step: 'committed' })).text).toContain(
    'COMMIT_REQUIRED',
  );
  expect(
    (await call('agent_step', { name: 'cart', step: 'committed', commit: 'abc123' })).text,
  ).toBe('✅ cart committed abc123, closed');
  expect(carnet.agents.get(SESSION, 'cart')?.status).toBe('closed');
  expect(carnet.table.get(SESSION)).toBeUndefined();
  const types = carnet.events
    .read(SESSION, 200, true)
    .filter((event) => event.agent === 'cart')
    .map((event) => event.type);
  expect(types).toEqual([
    'started',
    'finished',
    'answered',
    'applied',
    'tested',
    'committed',
    'dropped',
  ]);
});

test('agent_step next overrides the status, dropped closes with the reason', async () => {
  await call('agent_start', { name: 'promo', task: 't' });
  await call('agent_done', { name: 'promo', report_path: 'promo.md', has_questions: true });
  await call('table_set', { text: 'promo: report, questions', status: 'answer' });
  await call('agent_step', { name: 'promo', step: 'answered', next: 'running' });
  expect(carnet.agents.get(SESSION, 'promo')?.status).toBe('running');
  expect(carnet.table.get(SESSION)).toBeUndefined();
  expect(
    (await call('agent_step', { name: 'promo', step: 'dropped', note: 'not needed' })).text,
  ).toBe('promo dropped, closed');
  expect(carnet.events.read(SESSION, 1)[0]).toMatchObject({ type: 'dropped', note: 'not needed' });
  expect((await call('agent_step', { name: 'ghost', step: 'tested' })).text).toContain(
    'AGENT_NOT_FOUND',
  );
});
