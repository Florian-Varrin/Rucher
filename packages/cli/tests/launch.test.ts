import { existsSync, lstatSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createWorkspace, openCarnet } from '@rucher/carnet';
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
import { CliError } from '../src/session.ts';
import { makeIo, tempDirectory, writeConversation } from './helpers.ts';

function shopWorkspace() {
  const api = join(tempDirectory('repos-'), 'shop-api');
  mkdirSync(join(api, 'src'), { recursive: true });
  const env = { RUCHER_HOME: tempDirectory('home-'), CLAUDE_CONFIG_DIR: tempDirectory('claude-') };
  const root = createWorkspace('shop', { env, repos: [api] }).runDirectory;
  const carnet = openCarnet({ workspace: 'shop', env });
  return { root, api, env, carnet };
}

test('arguments after -- are passed through, positionals are read before them', () => {
  const { own, passthrough } = splitPassthrough(['shop-auth', '--', '--model', 'opus']);
  expect(passthrough).toEqual(['--model', 'opus']);
  expect(positionals(own)).toEqual(['shop-auth']);
  expect(splitPassthrough(['--', '-p', 'hi'])).toEqual({ own: [], passthrough: ['-p', 'hi'] });
  expect(positionals(['main', 'alt', '--active'])).toEqual(['main', 'alt']);
});

test("rucher new starts a named active session from the workspace's run directory", () => {
  const { root, api, carnet } = shopWorkspace();
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
    '--append-system-prompt-file',
    expect.stringMatching(/state\/prompts\/.+\.md$/),
    '--add-dir',
    api,
    '--model',
    'opus',
  ]);
  expect(plan.cwd).toBe(root);
  expect(plan.env).toEqual({
    RUCHER_SESSION_ID: plan.sessionId,
    CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
    RUCHER_PROMPT_VERSION: expect.stringMatching(/^[0-9a-f]{12}$/),
    RUCHER_SESSION_NAME: 'shop-auth',
    RUCHER_WS: 'shop',
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
  const { api, carnet } = shopWorkspace();
  const unnamed = planNew(carnet, makeIo(), { kind: 'temp' });
  expect(unnamed.args).toEqual([
    '--session-id',
    unnamed.sessionId,
    '--append-system-prompt-file',
    expect.stringMatching(/state\/prompts\/.+\.md$/),
    '--add-dir',
    api,
  ]);
  expect(carnet.sessions.require(unnamed.sessionId ?? '')).toMatchObject({
    kind: 'temp',
    name: null,
  });
  const named = planNew(carnet, makeIo(), { kind: 'temp', name: 'shop-try' });
  expect(carnet.sessions.require(named.sessionId ?? '').kind).toBe('temp');
});

test('a launch runs the session, and its exit ends it once', () => {
  const { root, api, env, carnet } = shopWorkspace();
  const plan = planNew(carnet, makeIo({ env }), { kind: 'active', name: 'shop-auth' });
  finishLaunch(carnet, plan);
  const id = plan.sessionId ?? '';
  writeConversation(env, root, id);
  expect(carnet.sessions.require(id).status).toBe('idle');
  expect(carnet.sessions.require(id).endedAt).not.toBeNull();
  finishLaunch(carnet, plan);
  expect(carnet.events.read(id).filter((event) => event.type === 'session.ended')).toHaveLength(1);
  const resume = planResume(carnet, makeIo({ env }), 'shop-auth', ['-p', 'hi']);
  expect(resume.args).toEqual([
    '--resume',
    id,
    '--name',
    'shop-auth',
    '--append-system-prompt-file',
    expect.stringMatching(/state\/prompts\/.+\.md$/),
    '--add-dir',
    api,
    '-p',
    'hi',
  ]);
  startLaunch(carnet, resume);
  expect(carnet.sessions.require(id).status).toBe('running');
});

test('rucher fork branches a session; the hook records the child with its parent', () => {
  const { root, api, env, carnet } = shopWorkspace();
  const parent = planNew(carnet, makeIo({ env }), { kind: 'active', name: 'shop-auth' });
  carnet.sessions.recordPromptVersion(parent.sessionId ?? '', 'abcdef012345');
  writeConversation(env, root, parent.sessionId ?? '');
  const fork = planFork(carnet, makeIo({ env }), 'shop-auth', { name: 'shop-auth-alt' });
  expect(fork.args).toEqual([
    '--resume',
    parent.sessionId,
    '--fork-session',
    '--name',
    'shop-auth-alt',
    '--append-system-prompt-file',
    expect.stringMatching(/state\/prompts\/.+\.md$/),
    '--add-dir',
    api,
  ]);
  expect(fork.env).toMatchObject({
    RUCHER_SESSION_ID: parent.sessionId,
    RUCHER_SESSION_KIND: 'temp',
    RUCHER_SESSION_NAME: 'shop-auth-alt',
    RUCHER_PROMPT_VERSION: 'abcdef012345',
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
  expect(() => planFork(after, makeIo({ env }), 'shop-auth', { active: true })).toThrowError(
    /needs a name/,
  );
  after.close();
});

test('the session-end hook ends a session launched outside rucher, and never fails', () => {
  const { root, env, carnet } = shopWorkspace();
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
  const { carnet } = shopWorkspace();
  planNew(carnet, makeIo(), { kind: 'temp' });
  planNew(carnet, makeIo(), { kind: 'active', name: 'shop-auth' });
  const sessions = pickerSessions(carnet);
  expect(sessions.map((session) => session.name)).toEqual(['shop-auth', null]);
  const lines = pickerLines(sessions, new Date());
  expect(lines[0]).toMatch(/^1 {2}shop-auth {2}active {2}running {2}\d{2}:\d{2} {2}[0-9a-f]{8}$/);
  expect(lines[1]).toMatch(/^2 {2}[0-9a-f]{8} +temp +running/);
});

test('rucher new renders the run directory before launching, and stays in place without a workspace', () => {
  const { root, carnet } = shopWorkspace();
  rmSync(root, { recursive: true });
  const plan = planNew(carnet, makeIo(), { kind: 'temp' });
  expect(plan.cwd).toBe(root);
  expect(lstatSync(join(root, 'CLAUDE.md')).isFile()).toBe(true);
  expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(true);

  const env = { RUCHER_HOME: tempDirectory('home-') };
  const free = openCarnet({ env, cwd: tempDirectory('free-') });
  const here = tempDirectory('here-');
  const solo = planNew(free, makeIo({ cwd: here, env }), { kind: 'temp' });
  expect(solo.cwd).toBe(here);
  expect(solo.args).not.toContain('--add-dir');
  expect(solo.env.RUCHER_WS).toBeUndefined();
  expect(solo.env.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD).toBe('1');
});

test('resume and fork re-render the workspace of the session and keep its directory', () => {
  const { root, carnet, env } = shopWorkspace();
  const plan = planNew(carnet, makeIo({ env }), { kind: 'active', name: 'shop-auth' });
  writeConversation(env, root, plan.sessionId ?? '');
  rmSync(join(root, '.claude'), { recursive: true });
  const resumed = planResume(carnet, makeIo({ env }), 'shop-auth');
  expect(resumed.cwd).toBe(root);
  expect(resumed.env.RUCHER_WS).toBe('shop');
  expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(true);
  expect(planFork(carnet, makeIo({ env }), 'shop-auth').cwd).toBe(root);
  expect(plan.sessionId).toBeDefined();
});

test('resume fails clearly when the recorded directory is gone', () => {
  const { carnet, env } = shopWorkspace();
  const gone = join(tempDirectory('gone-'), 'repo');
  mkdirSync(gone);
  carnet.sessions.create({ id: 'shop-gone-id', kind: 'active', name: 'shop-gone', cwd: gone });
  rmSync(gone, { recursive: true });
  expect(() => planResume(carnet, makeIo({ env }), 'shop-gone')).toThrowError(/no longer exists/);
});

test('resume starts a session closed before its first message under the same id and name', () => {
  const { root, api, env, carnet } = shopWorkspace();
  const plan = planNew(carnet, makeIo({ env }), { kind: 'active', name: 'shop-auth' });
  finishLaunch(carnet, plan);
  const id = plan.sessionId ?? '';
  const io = makeIo({ env });
  const fresh = planResume(carnet, io, 'shop-auth');
  expect(fresh.args).toEqual([
    '--session-id',
    id,
    '--name',
    'shop-auth',
    '--append-system-prompt-file',
    expect.stringMatching(/state\/prompts\/.+\.md$/),
    '--add-dir',
    api,
  ]);
  expect(fresh).toMatchObject({ cwd: root, sessionId: id });
  expect(io.errors).toEqual(['no conversation yet for shop-auth: starting it\n']);
  expect(carnet.sessions.require(id).name).toBe('shop-auth');
});

test('resume keeps --resume when the conversation is filed under another directory', () => {
  const { env, carnet } = shopWorkspace();
  const plan = planNew(carnet, makeIo({ env }), { kind: 'active', name: 'shop-auth' });
  writeConversation(env, tempDirectory('elsewhere-'), plan.sessionId ?? '');
  const io = makeIo({ env });
  expect(planResume(carnet, io, 'shop-auth').args.slice(0, 2)).toEqual([
    '--resume',
    plan.sessionId,
  ]);
  expect(io.errors).toEqual([]);
});

test('fork refuses a session with no conversation yet and points to resume', () => {
  const { env, carnet } = shopWorkspace();
  planNew(carnet, makeIo({ env }), { kind: 'active', name: 'shop-auth' });
  let error: unknown;
  try {
    planFork(carnet, makeIo({ env }), 'shop-auth');
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(CliError);
  expect(error).toMatchObject({
    message: 'Session shop-auth has no conversation yet, nothing to fork',
    hint: 'rucher resume shop-auth',
  });
});
