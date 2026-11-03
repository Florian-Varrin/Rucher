import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Carnet, CarnetError, MEMORY_DB, openDatabase } from '@rucher/carnet';
import { expect, test } from 'vite-plus/test';
import { logOnce } from '../src/commands/log.ts';
import {
  parseDuration,
  sessionsClean,
  sessionsDemote,
  sessionsDrop,
  sessionsPromote,
  sessionsRename,
} from '../src/commands/sessions.ts';
import { makeIo, tempDirectory } from './helpers.ts';

const DAY = 86_400_000;

function shop() {
  const root = tempDirectory();
  const clock = { time: Date.parse('2026-11-01T10:00:00.000Z') };
  const group = {
    root,
    name: 'shop',
    repos: [join(root, 'shop-api')],
    hosts: ['claude-code'],
    dbPath: MEMORY_DB,
  };
  const carnet = new Carnet(group, openDatabase(MEMORY_DB), { now: () => new Date(clock.time) });
  const session = (id: string, kind: 'active' | 'temp', name?: string) =>
    carnet.sessions.create({ id, kind, name, cwd: root });
  return { root, clock, carnet, session };
}

function codeOf(run: () => void): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof CarnetError ? error.code : String(error);
  }
  return undefined;
}

test('rename refuses a running session and a taken name, and survives the old host title', () => {
  const { carnet, session } = shop();
  session('a1', 'active', 'shop-auth');
  session('b1', 'active', 'shop-cart');
  expect(codeOf(() => sessionsRename(carnet, 'shop-auth', 'shop-login', makeIo()))).toBe(
    'SESSION_RUNNING',
  );
  carnet.sessions.end('a1');
  expect(codeOf(() => sessionsRename(carnet, 'shop-auth', 'shop-cart', makeIo()))).toBe(
    'SESSION_NAME_TAKEN',
  );
  const io = makeIo();
  sessionsRename(carnet, 'shop-auth', 'shop-login', io);
  expect(io.output.join('')).toContain('renamed to shop-login');
  carnet.sessions.adoptTitle('a1', 'shop-auth');
  expect(carnet.sessions.require('a1').name).toBe('shop-login');
});

test('promote needs a name and an unpromoted session; demote keeps the name', () => {
  const { carnet, session } = shop();
  session('t1', 'temp');
  carnet.sessions.end('t1');
  expect(codeOf(() => sessionsPromote(carnet, 't1', undefined, makeIo()))).toBe(
    'SESSION_NAME_REQUIRED',
  );
  sessionsPromote(carnet, 't1', 'shop-try', makeIo());
  expect(carnet.sessions.require('t1')).toMatchObject({ kind: 'active', name: 'shop-try' });
  expect(codeOf(() => sessionsPromote(carnet, 'shop-try', undefined, makeIo()))).toBe(
    'SESSION_KIND_INVALID',
  );
  sessionsDemote(carnet, 'shop-try', makeIo());
  expect(carnet.sessions.require('t1')).toMatchObject({ kind: 'temp', name: 'shop-try' });
  expect(codeOf(() => sessionsDemote(carnet, 'shop-try', makeIo()))).toBe('SESSION_KIND_INVALID');
});

test('drop archives, and only --purge deletes the transcript', () => {
  const { root, carnet, session } = shop();
  const config = tempDirectory('claude-config-');
  const project = join(config, 'projects', root.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(join(project, 'a1', 'subagents'), { recursive: true });
  writeFileSync(join(project, 'a1.jsonl'), '{}\n');
  session('a1', 'active', 'shop-auth');
  carnet.sessions.end('a1');
  const env = { CLAUDE_CONFIG_DIR: config };

  sessionsDrop(carnet, 'shop-auth', makeIo({ env }));
  expect(carnet.sessions.require('a1').status).toBe('archived');
  expect(existsSync(join(project, 'a1.jsonl'))).toBe(true);

  const io = makeIo({ env });
  sessionsDrop(carnet, 'shop-auth', io, { purge: true });
  expect(existsSync(join(project, 'a1.jsonl'))).toBe(false);
  expect(existsSync(join(project, 'a1'))).toBe(false);
  expect(io.output.join('')).toContain(`deleted ${join(project, 'a1.jsonl')}`);
});

test('clean archives idle temp sessions past the delay, dry run first', () => {
  const { clock, carnet, session } = shop();
  session('old', 'temp', 'shop-spike');
  carnet.sessions.end('old');
  session('kept', 'active', 'shop-auth');
  carnet.sessions.end('kept');
  clock.time += 3 * DAY;
  session('new', 'temp');
  carnet.sessions.end('new');
  clock.time += 5 * DAY;

  const dry = makeIo();
  sessionsClean(carnet, dry, { olderThan: '7d', dryRun: true });
  expect(dry.output.join('')).toBe('would archive shop-spike\n');
  expect(carnet.sessions.require('old').status).toBe('idle');

  sessionsClean(carnet, makeIo(), { olderThan: '7d' });
  expect(carnet.sessions.require('old').status).toBe('archived');
  expect(carnet.sessions.require('new').status).toBe('idle');
  expect(carnet.sessions.require('kept').status).toBe('idle');

  sessionsClean(carnet, makeIo(), { olderThan: '4d' });
  expect(carnet.sessions.require('new').status).toBe('archived');
});

test('clean resets running sessions whose host process is gone', () => {
  const { carnet, session } = shop();
  session('alive', 'active', 'shop-auth');
  session('gone', 'active', 'shop-cart');
  carnet.sessions.upsertFromHook({ session_id: 'alive' }, { processId: 100 });
  carnet.sessions.upsertFromHook({ session_id: 'gone' }, { processId: 200 });
  const io = makeIo();
  sessionsClean(carnet, io, { isAlive: (processId) => processId === 100 });
  expect(carnet.sessions.require('alive').status).toBe('running');
  expect(carnet.sessions.require('gone').status).toBe('idle');
  expect(io.output.join('')).toContain('shop-cart was marked running but its process is gone');
});

test('durations accept minutes, hours and days', () => {
  expect(parseDuration('30m')).toBe(30 * 60_000);
  expect(parseDuration('12h')).toBe(12 * 3_600_000);
  expect(parseDuration('7d')).toBe(7 * DAY);
  expect(parseDuration('2')).toBe(2 * DAY);
  expect(() => parseDuration('soon')).toThrowError(/Invalid duration/);
});

test('log --agents leaves out session lifecycle events', () => {
  const { carnet, session } = shop();
  session('a1', 'active', 'shop-auth');
  carnet.events.log('a1', { type: 'session.started' });
  carnet.agents.start('a1', { name: 'banner', task: 't' });
  const all = makeIo();
  logOnce(carnet, all, { session: 'shop-auth', count: 20 });
  expect(all.output.join('')).toContain('session.started');
  const agents = makeIo();
  logOnce(carnet, agents, { session: 'shop-auth', count: 20, agents: true });
  expect(agents.output.join('')).not.toContain('session.');
  expect(agents.output.join('')).toContain('banner');
});
