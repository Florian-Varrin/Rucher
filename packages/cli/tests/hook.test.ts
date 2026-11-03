import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  createGroup,
  openCarnet,
  OUTSIDE_RUCHER_NOTICE,
  rulesVersion,
  SUBAGENT_RULES,
} from '@rucher/carnet';
import { expect, test } from 'vite-plus/test';
import {
  postToolUse,
  sessionStart,
  subagentStart,
  subagentStop,
  userPromptSubmit,
} from '../src/commands/hook.ts';
import { makeIo, SESSION, tempDirectory } from './helpers.ts';

function group() {
  const api = tempDirectory('repo-api-');
  mkdirSync(join(api, 'src'), { recursive: true });
  const home = { RUCHER_HOME: tempDirectory('home-'), CLAUDE_PID: '4242' };
  const group = createGroup('shop', { env: home, repos: [api] });
  const root = group.workspace;
  const env = {
    ...home,
    RUCHER_SESSION_ID: SESSION,
    RUCHER_PROMPT_VERSION: rulesVersion(group, home),
  };
  return { root, api, env };
}

test('records the session of a group with pid and repo', () => {
  const { root, api, env } = group();
  const io = makeIo({ env });
  const payload = JSON.stringify({
    session_id: SESSION,
    cwd: join(api, 'src'),
    source: 'startup',
  });
  expect(sessionStart(payload, io)).toBe(0);
  expect(io.output).toEqual([]);
  expect(io.errors).toEqual([]);
  const carnet = openCarnet({ cwd: root, env });
  expect(carnet.sessions.get(SESSION)).toMatchObject({
    kind: 'temp',
    repo: api.split('/').at(-1),
    hostPid: 4242,
  });
  carnet.close();
});

test('outside any group it stays silent and succeeds', () => {
  const io = makeIo({ env: { RUCHER_HOME: tempDirectory('home-') } });
  const payload = JSON.stringify({ session_id: SESSION, cwd: tempDirectory('nogroup-') });
  expect(sessionStart(payload, io)).toBe(0);
  expect(io.output).toEqual([]);
  expect(io.errors).toEqual([]);
});

test('malformed input never fails the hook', () => {
  const io = makeIo();
  expect(sessionStart('not json', io)).toBe(0);
  expect(io.errors.join('')).toMatch(/^rucher hook: /);
  const io2 = makeIo();
  expect(sessionStart('{}', io2)).toBe(0);
  expect(io2.errors.join('')).toContain('session_id');
});

test('on resume it prints the session state as additional context', () => {
  const { api, env } = group();
  const startup = JSON.stringify({ session_id: SESSION, cwd: api, source: 'startup' });
  sessionStart(startup, makeIo({ env }));
  const io = makeIo({ env });
  expect(
    sessionStart(JSON.stringify({ session_id: SESSION, cwd: api, source: 'resume' }), io),
  ).toBe(0);
  const output = JSON.parse(io.output.join('')) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string };
  };
  expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');
  expect(output.hookSpecificOutput.additionalContext).toContain('state when resumed');
});

test('subagent hooks flag a fork that stopped without agent_done', () => {
  const { root, env } = group();
  const carnet = openCarnet({ cwd: root, env });
  carnet.sessions.upsertFromHook({ session_id: SESSION, cwd: root, source: 'startup' });
  carnet.agents.start(SESSION, { name: 'lost', task: 't' });
  carnet.close();
  const io = makeIo({ env });
  const payload = (event: string) =>
    JSON.stringify({
      session_id: SESSION,
      cwd: root,
      agent_id: 'a1',
      agent_type: 'fork',
      hook_event_name: event,
    });
  expect(subagentStart(payload('SubagentStart'), io)).toBe(0);
  expect(subagentStop(payload('SubagentStop'), io)).toBe(0);
  expect(io.errors).toEqual([]);
  const after = openCarnet({ cwd: root, env });
  expect(after.agents.get(SESSION, 'lost')).toMatchObject({
    status: 'review',
    hostAgentId: 'a1',
  });
  after.close();
});

test('subagent hooks never fail, even without agent_id or group', () => {
  const io = makeIo({ env: { RUCHER_HOME: tempDirectory('home-') } });
  expect(
    subagentStop(
      JSON.stringify({ session_id: SESSION, agent_id: 'a', cwd: tempDirectory('nogroup-') }),
      io,
    ),
  ).toBe(0);
  expect(io.errors).toEqual([]);
  const io2 = makeIo();
  expect(subagentStart(JSON.stringify({ session_id: SESSION }), io2)).toBe(0);
  expect(io2.errors.join('')).toContain('agent_id');
});

test('the prompt hook names the session after a /rename and never fails', () => {
  const { root, env } = group();
  const io = makeIo({ env });
  sessionStart(JSON.stringify({ session_id: SESSION, cwd: root, source: 'startup' }), io);
  const prompt = JSON.stringify({ session_id: SESSION, cwd: root, session_title: 'shop-auth' });
  expect(userPromptSubmit(prompt, io)).toBe(0);
  expect(io.output).toEqual([]);
  const carnet = openCarnet({ cwd: root, env });
  expect(carnet.sessions.get(SESSION)).toMatchObject({ name: 'shop-auth', kind: 'active' });
  carnet.close();
  const outside = makeIo({ env: { RUCHER_HOME: tempDirectory('home-') } });
  expect(
    userPromptSubmit(JSON.stringify({ session_id: SESSION, cwd: tempDirectory() }), outside),
  ).toBe(0);
  expect(outside.errors).toEqual([]);
  expect(userPromptSubmit('{}', makeIo())).toBe(0);
});

test('a stop names its fork even when the starts arrived in the wrong order', () => {
  const { root, env } = group();
  const carnet = openCarnet({ cwd: root, env });
  carnet.sessions.upsertFromHook({ session_id: SESSION, cwd: root, source: 'startup' });
  carnet.agents.start(SESSION, { name: 'memory', task: 't' });
  carnet.agents.start(SESSION, { name: 'launch', task: 't' });
  carnet.close();
  const io = makeIo({ env });
  const event = (name: string, agentId: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      session_id: SESSION,
      cwd: root,
      agent_id: agentId,
      hook_event_name: name,
      ...extra,
    });
  subagentStart(event('SubagentStart', 'id-launch'), io);
  subagentStart(event('SubagentStart', 'id-memory'), io);
  const tasks = [
    { id: 'id-memory', description: 'memory' },
    { id: 'id-launch', description: 'launch' },
  ];
  expect(subagentStop(event('SubagentStop', 'id-memory', { background_tasks: tasks }), io)).toBe(0);
  expect(io.errors).toEqual([]);
  const after = openCarnet({ cwd: root, env });
  expect(after.agents.get(SESSION, 'memory')).toMatchObject({
    status: 'review',
    hostAgentId: 'id-memory',
  });
  expect(after.agents.get(SESSION, 'launch')).toMatchObject({
    status: 'running',
    hostAgentId: 'id-launch',
  });
  after.close();
});

test('a session started without rucher is warned on stderr and in context', () => {
  const { root, env } = group();
  const io = makeIo({ env: { RUCHER_HOME: env.RUCHER_HOME, CLAUDE_PID: env.CLAUDE_PID } });
  const payload = JSON.stringify({ session_id: SESSION, cwd: root, source: 'startup' });
  expect(sessionStart(payload, io)).toBe(0);
  expect(io.errors).toEqual([`${OUTSIDE_RUCHER_NOTICE}\n`]);
  expect(io.output.join('')).toContain('started without rucher');
});

test('named sub-agents get the reporting rules, forks inherit them', () => {
  const { root, env } = group();
  const carnet = openCarnet({ cwd: root, env });
  carnet.sessions.upsertFromHook({ session_id: SESSION, cwd: root, source: 'startup' });
  carnet.close();
  const event = (agentType: string) =>
    JSON.stringify({
      session_id: SESSION,
      cwd: root,
      agent_id: `a-${agentType}`,
      agent_type: agentType,
    });
  const explore = makeIo({ env });
  expect(subagentStart(event('Explore'), explore)).toBe(0);
  expect(JSON.parse(explore.output.join(''))).toEqual({
    hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: SUBAGENT_RULES },
  });
  const fork = makeIo({ env });
  expect(subagentStart(event('fork'), fork)).toBe(0);
  expect(fork.output).toEqual([]);
});

test('post-tool-use adds a repo memory once, and stays silent otherwise', () => {
  const { root, api, env } = group();
  const carnet = openCarnet({ cwd: root, env });
  carnet.notes.add({
    kind: 'dead_end',
    text: 'retrying the payment webhook twice double charges the customer',
    repos: [api.split('/').pop() ?? ''],
  });
  carnet.close();
  const payload = (input: Record<string, unknown>) =>
    JSON.stringify({ session_id: SESSION, cwd: root, tool_name: 'Read', tool_input: input });
  const first = makeIo({ env });
  expect(postToolUse(payload({ file_path: join(api, 'src', 'pay.ts') }), first)).toBe(0);
  const output = JSON.parse(first.output.join('')) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string };
  };
  expect(output.hookSpecificOutput.hookEventName).toBe('PostToolUse');
  expect(output.hookSpecificOutput.additionalContext).toContain('double charges');
  const again = makeIo({ env });
  postToolUse(payload({ file_path: join(api, 'src', 'other.ts') }), again);
  expect(again.output).toEqual([]);
  const outside = makeIo({ env });
  postToolUse(payload({ file_path: join(root, 'notes.md') }), outside);
  expect(outside.output).toEqual([]);
  expect(outside.errors).toEqual([]);
});

function twoGroupsSharingApi() {
  const api = tempDirectory('repo-api-');
  const env = { RUCHER_HOME: tempDirectory('home-'), CLAUDE_PID: '4242' };
  const shop = createGroup('shop', { env, repos: [api] }).workspace;
  const blog = createGroup('blog', { env, repos: [api] }).workspace;
  return { api, shop, blog, env };
}

test('a repo shared by two groups records nothing and warns in context and on stderr', () => {
  const { api, shop, blog, env } = twoGroupsSharingApi();
  const io = makeIo({ env });
  const start = JSON.stringify({ session_id: SESSION, cwd: api, source: 'compact' });
  expect(sessionStart(start, io)).toBe(0);
  expect(io.errors).toHaveLength(1);
  expect(io.errors[0]).toMatch(/several groups \(shop, blog\)|several groups \(blog, shop\)/);
  const output = JSON.parse(io.output.join('')) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string };
  };
  expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');
  expect(output.hookSpecificOutput.additionalContext).toMatch(/Carnet records nothing/);
  const prompt = makeIo({ env });
  const submit = JSON.stringify({ session_id: SESSION, cwd: api, prompt: 'go' });
  expect(userPromptSubmit(submit, prompt)).toBe(0);
  expect(prompt.output.join('')).toMatch(/"hookEventName":"UserPromptSubmit"/);
  for (const root of [shop, blog]) {
    const carnet = openCarnet({ cwd: root, env });
    expect(carnet.sessions.get(SESSION)).toBeUndefined();
    carnet.close();
  }
});

test('the group named by the launcher wins over a shared repo', () => {
  const { api, blog, env } = twoGroupsSharingApi();
  const pinned = makeIo({ env: { ...env, RUCHER_GROUP: 'blog' } });
  const start = JSON.stringify({ session_id: SESSION, cwd: api, source: 'startup' });
  expect(sessionStart(start, pinned)).toBe(0);
  expect(pinned.errors.join('')).not.toMatch(/several groups/);
  const inBlog = openCarnet({ cwd: blog, env });
  expect(inBlog.sessions.get(SESSION)).toBeDefined();
  inBlog.close();
});

// Needs sessions.group_name: the session id lookup has nothing to read before it.
test.skip('a known session id keeps the session in its group', () => {
  const { api, shop, blog, env } = twoGroupsSharingApi();
  const pinned = makeIo({ env: { ...env, RUCHER_GROUP: 'blog' } });
  const start = JSON.stringify({ session_id: SESSION, cwd: api, source: 'startup' });
  expect(sessionStart(start, pinned)).toBe(0);
  const compacted = JSON.stringify({ session_id: SESSION, cwd: api, source: 'compact' });
  expect(sessionStart(compacted, makeIo({ env }))).toBe(0);
  const inBlog = openCarnet({ cwd: blog, env });
  expect(inBlog.sessions.get(SESSION)).toBeDefined();
  inBlog.close();
  const inShop = openCarnet({ cwd: shop, env });
  expect(inShop.sessions.get(SESSION)).toBeUndefined();
  inShop.close();
});
