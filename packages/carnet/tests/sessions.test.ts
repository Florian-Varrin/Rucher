import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { CarnetError, handleSessionStart, parseHookPayload } from '../src/index.ts';
import { makeCarnet, SESSION } from './helpers.ts';

test('hook upsert creates a temporary session and records repo and pid', () => {
  const { carnet, root } = makeCarnet();
  const session = carnet.sessions.upsertFromHook(
    { session_id: SESSION, cwd: join(root, 'api', 'src'), source: 'startup' },
    { CLAUDE_PID: '4242' },
  );
  expect(session).toMatchObject({
    id: SESSION,
    name: null,
    status: 'temporary',
    repo: 'api',
    claudePid: 4242,
  });
  expect(carnet.sessions.byClaudePid(4242)?.id).toBe(SESSION);
  expect(carnet.sessions.list()).toEqual([]);
  expect(carnet.sessions.list({ includeTemporary: true })).toHaveLength(1);
});

test('repeat hook updates activity and adopts a title once', () => {
  const { carnet, root } = makeCarnet();
  const first = carnet.sessions.upsertFromHook({ session_id: SESSION, cwd: root });
  const second = carnet.sessions.upsertFromHook({
    session_id: SESSION,
    cwd: root,
    source: 'resume',
    session_title: 'banner',
  });
  expect(second.lastActiveAt > first.lastActiveAt).toBe(true);
  expect(second).toMatchObject({ name: 'banner', status: 'active', repo: null });
  const third = carnet.sessions.upsertFromHook({
    session_id: SESSION,
    cwd: root,
    session_title: 'other',
  });
  expect(third.name).toBe('banner');
});

test('a titled first start is active immediately', () => {
  const { carnet, root } = makeCarnet();
  const session = carnet.sessions.upsertFromHook({
    session_id: SESSION,
    cwd: root,
    session_title: 'dto',
  });
  expect(session).toMatchObject({ name: 'dto', status: 'active' });
});

test('naming promotes a temporary session and rejects duplicates', () => {
  const { carnet, root } = makeCarnet();
  carnet.sessions.upsertFromHook({ session_id: SESSION, cwd: root });
  carnet.sessions.upsertFromHook({ session_id: 'other', cwd: root });
  const named = carnet.sessions.name(SESSION, 'small ui changes', 'durable thread');
  expect(named).toMatchObject({
    name: 'small ui changes',
    purpose: 'durable thread',
    status: 'active',
  });
  expect(carnet.sessions.byName('small ui changes')?.id).toBe(SESSION);
  try {
    carnet.sessions.name('other', 'small ui changes');
    expect.unreachable();
  } catch (error) {
    expect((error as CarnetError).code).toBe('SESSION_NAME_TAKEN');
  }
});

test('default session is the most recently active non-dropped one', () => {
  const { carnet, root } = makeCarnet();
  carnet.sessions.upsertFromHook({ session_id: 'a', cwd: root });
  carnet.sessions.upsertFromHook({ session_id: 'b', cwd: root });
  expect(carnet.sessions.default()?.id).toBe('b');
  carnet.sessions.touch('a');
  expect(carnet.sessions.default()?.id).toBe('a');
  carnet.sessions.drop('a');
  expect(carnet.sessions.default()?.id).toBe('b');
});

test('dropping a session closes its agents', () => {
  const { carnet, root } = makeCarnet();
  carnet.sessions.upsertFromHook({ session_id: SESSION, cwd: root });
  carnet.agents.start(SESSION, { name: 'banner', task: 'do it' });
  carnet.sessions.drop(SESSION);
  expect(carnet.sessions.get(SESSION)?.status).toBe('dropped');
  expect(carnet.agents.list(SESSION)).toEqual([]);
  expect(carnet.agents.list(SESSION, { includeClosed: true })[0]?.status).toBe('closed');
});

test('ensure creates a temporary row when the hook was missed', () => {
  const { carnet, root } = makeCarnet();
  const session = carnet.sessions.ensure(SESSION, join(root, 'api'));
  expect(session).toMatchObject({ status: 'temporary', repo: 'api' });
  expect(carnet.sessions.ensure(SESSION).createdAt).toBe(session.createdAt);
});

test('parseHookPayload validates and handleSessionStart upserts', () => {
  const { carnet, root } = makeCarnet();
  const payload = parseHookPayload(
    JSON.stringify({
      session_id: SESSION,
      cwd: root,
      source: 'startup',
      hook_event_name: 'SessionStart',
    }),
  );
  expect(payload).toEqual({
    session_id: SESSION,
    cwd: root,
    source: 'startup',
    session_title: undefined,
  });
  expect(handleSessionStart(carnet, payload, { CLAUDE_PID: '7' }).session.claudePid).toBe(7);
  expect(() => parseHookPayload('{}')).toThrowError(TypeError);
});
