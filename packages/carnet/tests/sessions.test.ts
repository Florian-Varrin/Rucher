import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { writeFileSync } from 'node:fs';
import {
  CarnetError,
  handleSessionStart,
  handleUserPromptSubmit,
  parseHookPayload,
  parsePromptPayload,
  transcriptTitle,
} from '../src/index.ts';
import { makeCarnet, SESSION, tempDirectory } from './helpers.ts';

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

test('repeat hook updates activity and follows a changed title', () => {
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
  expect(third.name).toBe('other');
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

test('find accepts a name, a full id or a unique id prefix, names first', () => {
  const { carnet, root } = makeCarnet();
  const first = '9cd374b8-9225-4ad8-8407-f38398966ed3';
  const second = '9cd3aaaa-1111-4222-8333-444455556666';
  carnet.sessions.ensure(first, root);
  carnet.sessions.ensure(second, root);
  carnet.sessions.name(second, 'shop-auth');
  expect(carnet.sessions.find('shop-auth').id).toBe(second);
  expect(carnet.sessions.find(first).id).toBe(first);
  expect(carnet.sessions.find('9cd374b8').id).toBe(first);
  expect(carnet.sessions.find('9CD374').id).toBe(first);
  carnet.sessions.name(first, '9cd3aaaa');
  expect(carnet.sessions.find('9cd3aaaa').id).toBe(first);
});

test('find refuses ambiguous, too short and unknown references', () => {
  const { carnet, root } = makeCarnet();
  carnet.sessions.ensure('9cd374b8-9225-4ad8-8407-f38398966ed3', root);
  carnet.sessions.ensure('9cd3aaaa-1111-4222-8333-444455556666', root);
  const codeOf = (reference: string) => {
    try {
      carnet.sessions.find(reference);
      return 'found';
    } catch (error) {
      return error instanceof CarnetError ? `${error.code}: ${error.message}` : 'other';
    }
  };
  expect(codeOf('9cd3')).toBe(
    'SESSION_AMBIGUOUS: Session id "9cd3" matches several sessions: 9cd3aaaa, 9cd374b8',
  );
  expect(codeOf('9cd')).toContain('SESSION_NOT_FOUND');
  expect(codeOf('9cd')).toContain('at least 4 characters');
  expect(codeOf('ffff')).toBe('SESSION_NOT_FOUND: Unknown session "ffff"');
  expect(codeOf('shop-typo')).toBe('SESSION_NOT_FOUND: Unknown session "shop-typo"');
});

test('a title taken by another session is not adopted', () => {
  const { carnet, root } = makeCarnet();
  carnet.sessions.upsertFromHook({ session_id: 'other', cwd: root, session_title: 'shop-auth' });
  const session = carnet.sessions.upsertFromHook({
    session_id: SESSION,
    cwd: root,
    session_title: 'shop-auth',
  });
  expect(session).toMatchObject({ name: null, status: 'temporary' });
  expect(carnet.sessions.byName('shop-auth')?.id).toBe('other');
});

test('the prompt hook names the session from the payload title', () => {
  const { carnet, root } = makeCarnet();
  carnet.sessions.upsertFromHook({ session_id: SESSION, cwd: root });
  const payload = parsePromptPayload(
    JSON.stringify({ session_id: SESSION, cwd: root, session_title: 'shop-auth', prompt: 'hi' }),
  );
  expect(handleUserPromptSubmit(carnet, payload)).toMatchObject({
    name: 'shop-auth',
    status: 'active',
  });
  const unchanged = handleUserPromptSubmit(carnet, payload);
  expect(unchanged.name).toBe('shop-auth');
});

test('without a payload title the prompt hook reads the last transcript title', () => {
  const { carnet, root } = makeCarnet();
  const transcript = join(tempDirectory('transcript-'), 'session.jsonl');
  const line = (title: string) =>
    JSON.stringify({ type: 'custom-title', customTitle: title, sessionId: SESSION });
  writeFileSync(transcript, `${line('shop-old')}\n{"type":"user"}\n${line('shop-cart')}\n`);
  expect(transcriptTitle(transcript)).toBe('shop-cart');
  expect(transcriptTitle(join(root, 'missing.jsonl'))).toBeUndefined();
  const session = handleUserPromptSubmit(carnet, {
    session_id: SESSION,
    cwd: root,
    transcript_path: transcript,
  });
  expect(session).toMatchObject({ name: 'shop-cart', status: 'active' });
});

test('the prompt hook leaves a session without any title untouched', () => {
  const { carnet, root } = makeCarnet();
  const session = handleUserPromptSubmit(carnet, { session_id: SESSION, cwd: root });
  expect(session).toMatchObject({ name: null, status: 'temporary' });
});
