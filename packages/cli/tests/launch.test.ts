import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { initGroup, openCarnet } from '@rucher/carnet';
import { expect, test } from 'vite-plus/test';
import { sessionEnd, sessionStart } from '../src/commands/hook.ts';
import {
  finishLaunch,
  planFork,
  planNew,
  planResume,
  positionals,
  splitPassthrough,
  startLaunch,
} from '../src/commands/launch.ts';
import { pickerLines, pickerSessions } from '../src/commands/picker.ts';
import { makeIo, tempDirectory } from './helpers.ts';

function shopGroup() {
  const root = tempDirectory('meta-');
  const api = join(tempDirectory('repos-'), 'shop-api');
  mkdirSync(join(api, 'src'), { recursive: true });
  const env = { RUCHER_HOME: tempDirectory('home-') };
  initGroup(root, { env, name: 'shop', repos: [api] });
  const carnet = openCarnet({ cwd: root, env });
  return { root, api, env, carnet };
}

test('arguments after -- are passed through, positionals are read before them', () => {
  const { own, passthrough } = splitPassthrough(['shop-auth', '--', '--model', 'opus']);
  expect(passthrough).toEqual(['--model', 'opus']);
  expect(positionals(own)).toEqual(['shop-auth']);
  expect(splitPassthrough(['--', '-p', 'hi'])).toEqual({ own: [], passthrough: ['-p', 'hi'] });
  expect(positionals(['main', 'alt', '--active'])).toEqual(['main', 'alt']);
});

test('rucher new starts a named active session from the meta directory', () => {
  const { root, api, carnet } = shopGroup();
  const plan = planNew(carnet, makeIo({ cwd: join(api, 'src') }), {
    kind: 'active',
    name: 'shop-auth',
    passthrough: ['--model', 'opus'],
  });
  expect(plan.command).toBe('claude');
  expect(plan.args).toEqual([
    '--session-id',
    plan.sessionId,
    '--name',
    'shop-auth',
    '--model',
    'opus',
  ]);
  expect(plan.cwd).toBe(root);
  expect(plan.env).toEqual({
    RUCHER_SESSION_ID: plan.sessionId,
    RUCHER_SESSION_NAME: 'shop-auth',
    RUCHER_GROUP: 'shop',
  });
  expect(carnet.sessions.require(plan.sessionId ?? '')).toMatchObject({
    name: 'shop-auth',
    kind: 'active',
    status: 'running',
    cwd: root,
    repo: 'shop-api',
    lastTitle: 'shop-auth',
  });
  expect(() => planNew(carnet, makeIo(), { kind: 'active' })).toThrowError(/needs a name/);
  expect(() => planNew(carnet, makeIo(), { kind: 'active', name: 'shop-auth' })).toThrowError(
    /already exists/,
  );
});

test('rucher tmp starts a temp session, named or not', () => {
  const { carnet } = shopGroup();
  const unnamed = planNew(carnet, makeIo(), { kind: 'temp' });
  expect(unnamed.args).toEqual(['--session-id', unnamed.sessionId]);
  expect(carnet.sessions.require(unnamed.sessionId ?? '')).toMatchObject({
    kind: 'temp',
    name: null,
  });
  const named = planNew(carnet, makeIo(), { kind: 'temp', name: 'shop-try' });
  expect(carnet.sessions.require(named.sessionId ?? '').kind).toBe('temp');
});

test('a launch runs the session, and its exit ends it once', () => {
  const { carnet } = shopGroup();
  const plan = planNew(carnet, makeIo(), { kind: 'active', name: 'shop-auth' });
  finishLaunch(carnet, plan);
  const id = plan.sessionId ?? '';
  expect(carnet.sessions.require(id).status).toBe('idle');
  expect(carnet.sessions.require(id).endedAt).not.toBeNull();
  finishLaunch(carnet, plan);
  expect(carnet.events.read(id).filter((event) => event.type === 'session.ended')).toHaveLength(1);
  const resume = planResume(carnet, makeIo(), 'shop-auth', ['-p', 'hi']);
  expect(resume.args).toEqual(['--resume', id, '--name', 'shop-auth', '-p', 'hi']);
  startLaunch(carnet, resume);
  expect(carnet.sessions.require(id).status).toBe('running');
});

test('rucher fork branches a session; the hook records the child with its parent', () => {
  const { root, env, carnet } = shopGroup();
  const parent = planNew(carnet, makeIo(), { kind: 'active', name: 'shop-auth' });
  const fork = planFork(carnet, makeIo(), 'shop-auth', { name: 'shop-auth-alt' });
  expect(fork.args).toEqual([
    '--resume',
    parent.sessionId,
    '--fork-session',
    '--name',
    'shop-auth-alt',
  ]);
  expect(fork.env).toMatchObject({
    RUCHER_SESSION_ID: parent.sessionId,
    RUCHER_SESSION_KIND: 'temp',
    RUCHER_SESSION_NAME: 'shop-auth-alt',
  });
  carnet.close();
  const payload = JSON.stringify({
    session_id: 'child-session',
    cwd: root,
    source: 'fork',
    session_title: 'shop-auth-alt',
  });
  expect(sessionStart(payload, makeIo({ env: { ...env, ...fork.env } }))).toBe(0);
  const after = openCarnet({ cwd: root, env });
  expect(after.sessions.require('child-session')).toMatchObject({
    parentId: parent.sessionId,
    kind: 'temp',
    name: 'shop-auth-alt',
    status: 'running',
  });
  finishLaunch(after, fork);
  expect(after.sessions.require('child-session').status).toBe('idle');
  expect(() => planFork(after, makeIo(), 'shop-auth', { active: true })).toThrowError(
    /needs a name/,
  );
  after.close();
});

test('the session-end hook ends a session launched outside rucher, and never fails', () => {
  const { root, env, carnet } = shopGroup();
  carnet.close();
  const start = JSON.stringify({ session_id: 'outside', cwd: root, source: 'startup' });
  sessionStart(start, makeIo({ env }));
  const io = makeIo({ env });
  const end = JSON.stringify({ session_id: 'outside', cwd: root, reason: 'prompt_input_exit' });
  expect(sessionEnd(end, io)).toBe(0);
  expect(io.output).toEqual([]);
  const after = openCarnet({ cwd: root, env });
  expect(after.sessions.require('outside').status).toBe('idle');
  after.close();
  expect(sessionEnd(JSON.stringify({ session_id: 'unknown', cwd: root }), makeIo({ env }))).toBe(0);
  expect(sessionEnd('{}', makeIo({ env }))).toBe(0);
});

test('the picker lists named sessions first, then temp ones by short id', () => {
  const { carnet } = shopGroup();
  planNew(carnet, makeIo(), { kind: 'temp' });
  planNew(carnet, makeIo(), { kind: 'active', name: 'shop-auth' });
  const sessions = pickerSessions(carnet);
  expect(sessions.map((session) => session.name)).toEqual(['shop-auth', null]);
  const lines = pickerLines(sessions, new Date());
  expect(lines[0]).toMatch(/^1 {2}shop-auth {2}active {2}running {2}\d{2}:\d{2} {2}[0-9a-f]{8}$/);
  expect(lines[1]).toMatch(/^2 {2}[0-9a-f]{8} +temp +running/);
});
