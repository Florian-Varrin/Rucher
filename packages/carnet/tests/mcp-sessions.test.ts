import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { beforeEach, expect, test } from 'vite-plus/test';
import type { Carnet } from '../src/index.ts';
import { createCarnetServer } from '../src/mcp/index.ts';
import { SESSION, withSession } from './helpers.ts';

let carnet: Carnet;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text?: string }[])
    .map((content) => content.text ?? '')
    .join('\n');
  return { text, isError: result.isError === true, data: result.structuredContent };
}

beforeEach(async () => {
  const made = withSession();
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

test('session_new names, renames and refuses a name taken by another session', async () => {
  const named = await call('session_new', { name: 'shop-auth', purpose: 'Login flow' });
  expect(named.text).toBe(
    'Session named shop-auth. Ask the human to run /rename shop-auth in Claude Code so the titles match.',
  );
  expect(carnet.sessions.get(SESSION)).toMatchObject({ name: 'shop-auth', status: 'active' });
  expect((await call('session_new', { name: 'shop-login' })).isError).toBe(false);
  expect(carnet.sessions.get(SESSION)).toMatchObject({ name: 'shop-login', purpose: 'Login flow' });

  carnet.sessions.ensure('other');
  carnet.sessions.name('other', 'shop-cart');
  const taken = await call('session_new', { name: 'shop-cart' });
  expect(taken.isError).toBe(true);
  expect(taken.text).toContain('SESSION_NAME_TAKEN');
});

test('session_list hides temporary sessions unless asked and marks the current one', async () => {
  carnet.sessions.ensure('temp');
  await call('session_new', { name: 'shop-auth' });
  expect((await call('session_list')).text).toBe('shop-auth [active] (current)');
  const all = await call('session_list', { include_temporary: true });
  expect(all.text.split('\n')).toEqual(['shop-auth [active] (current)', 'temp [temporary]']);
});

test('session_drop closes a session by name, unknown names are tool errors', async () => {
  carnet.sessions.ensure('other');
  carnet.sessions.name('other', 'shop-cart');
  carnet.agents.start('other', { name: 'banner', task: 't' });
  expect((await call('session_drop', { name: 'shop-cart' })).text).toBe(
    'Session shop-cart dropped',
  );
  expect(carnet.sessions.get('other')?.status).toBe('dropped');
  expect(carnet.agents.list('other')).toEqual([]);
  const unknown = await call('session_drop', { name: 'nope' });
  expect(unknown.isError).toBe(true);
  expect(unknown.text).toContain('SESSION_NOT_FOUND');
});

test('session_resume_info gives the state, last events and resume command', async () => {
  carnet.sessions.ensure('other');
  carnet.sessions.name('other', 'shop-cart', 'Cart page');
  carnet.agents.start('other', { name: 'banner', task: 'Add banner' });
  const info = await call('session_resume_info', { name: 'shop-cart' });
  expect(info.text).toContain('Rucher session shop-cart (Cart page)');
  expect(info.text).toContain('⏳ banner');
  expect(info.text).toMatch(/Last events\n {2}\d\d:\d\d {2}started {2}banner {2}Add banner/);
  expect(info.text.endsWith('Resume with: rucher resume shop-cart')).toBe(true);
  const own = await call('session_resume_info');
  expect(own.text).toContain(`Resume with: rucher resume ${SESSION}`);
});

test('log_read returns the last events oldest first', async () => {
  expect((await call('log_read')).text).toBe('no events yet');
  for (let index = 0; index < 3; index++)
    carnet.events.log(SESSION, { type: 'tested', note: `n${index}` });
  const read = await call('log_read', { limit: 2 });
  expect(read.text).toMatch(/^\d\d:\d\d {2}tested {2}n1\n\d\d:\d\d {2}tested {2}n2$/);
  expect((await call('log_read', { limit: 0 })).isError).toBe(true);
});
