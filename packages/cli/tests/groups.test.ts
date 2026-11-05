import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGroup, groupExists, loadGroup, openGroupCarnet } from '@rucher/carnet';
import { expect, test } from 'vite-plus/test';
import {
  groupsCreate,
  groupsDrop,
  groupsErrors,
  groupsList,
  groupsRename,
} from '../src/commands/groups.ts';
import { makeIo, SESSION, tempDirectory } from './helpers.ts';

function home() {
  return { RUCHER_HOME: tempDirectory('home-') };
}

function sessionIn(name: string, env: NodeJS.ProcessEnv, hostPid?: number) {
  const group = loadGroup(name, env);
  const carnet = openGroupCarnet(group, { env });
  carnet.sessions.upsertFromHook(
    { session_id: SESSION, cwd: group.workspace, source: 'startup' },
    { processId: hostPid ?? null },
  );
  carnet.sessions.name(SESSION, 'shop-auth', 'Login flow');
  if (hostPid)
    carnet.db.prepare("UPDATE sessions SET status = 'running' WHERE id = ?").run(SESSION);
  carnet.notes.add({ kind: 'learning', text: 'The api needs a seed before tests' });
  carnet.close();
}

test('groups list shows each group with its repo and session counts', () => {
  const env = home();
  createGroup('shop', { env, repos: [tempDirectory('shop-api-')] });
  const blog = createGroup('blog', { env });
  sessionIn('shop', env);
  const io = makeIo({ env });
  expect(groupsList(io)).toBe(0);
  const lines = io.output.join('').trimEnd().split('\n');
  expect(lines).toHaveLength(2);
  expect(lines[0]).toBe(`blog  0 repos  0 sessions  ${blog.workspace}`);
  expect(lines[1]).toMatch(/^shop  1 repo  1 session  /);
  const empty = makeIo({ env: home() });
  expect(groupsList(empty)).toBe(0);
  expect(empty.output.join('')).toContain('no group yet');
});

test('groups create writes the source and renders the workspace', () => {
  const env = home();
  const api = tempDirectory('shop-api-');
  const io = makeIo({ env });
  expect(groupsCreate('shop', io, { repos: [api] })).toBe(0);
  const group = loadGroup('shop', env);
  expect(group.repos.map((repo) => repo.path)).toEqual([api]);
  expect(existsSync(join(group.source, 'CLAUDE.md'))).toBe(true);
  expect(existsSync(group.workspace)).toBe(true);
  const output = io.output.join('');
  expect(output).toContain('shop created');
  expect(output).toContain(`workspace: ${group.workspace}`);
  expect(output).toContain('rucher new <session> -g shop');

  const again = makeIo({ env });
  expect(groupsErrors(again, () => groupsCreate('shop', again))).toBe(1);
  expect(again.errors.join('')).toContain('already exists');
  const invalid = makeIo({ env });
  expect(groupsErrors(invalid, () => groupsCreate('Shop', invalid))).toBe(1);
});

test('groups rename moves the source and the rows, never the workspace', () => {
  const env = home();
  const workspace = createGroup('shop', { env }).workspace;
  sessionIn('shop', env);
  const io = makeIo({ env });
  expect(groupsRename('shop', 'store', io, { isAlive: () => false })).toBe(0);
  expect(io.output.join('')).toContain(`its workspace stays at ${workspace}`);
  expect(groupExists('shop', env)).toBe(false);
  const store = loadGroup('store', env);
  expect(store.workspace).toBe(workspace);
  const carnet = openGroupCarnet(store, { env });
  expect(carnet.sessions.find('shop-auth').id).toBe(SESSION);
  expect(carnet.notes.list()).toHaveLength(1);
  carnet.close();
});

test('groups rename and drop refuse while a session of the group is running', () => {
  const env = home();
  createGroup('shop', { env });
  sessionIn('shop', env, 4242);
  const rename = makeIo({ env });
  expect(
    groupsErrors(rename, () => groupsRename('shop', 'store', rename, { isAlive: () => true })),
  ).toBe(1);
  expect(rename.errors.join('')).toContain('1 session of shop still running: shop-auth');
  const drop = makeIo({ env });
  expect(groupsErrors(drop, () => groupsDrop('shop', drop, { isAlive: () => true }))).toBe(1);
  expect(groupExists('shop', env)).toBe(true);
  const gone = makeIo({ env });
  expect(groupsErrors(gone, () => groupsRename('nope', 'other', gone))).toBe(1);
});

test('groups drop archives the sessions and keeps notes and workspace; --purge deletes them', () => {
  const env = home();
  const workspace = createGroup('shop', { env }).workspace;
  sessionIn('shop', env);
  const io = makeIo({ env });
  expect(groupsDrop('shop', io, { isAlive: () => false })).toBe(0);
  expect(io.output.join('')).toContain('sessions archived: 1');
  expect(groupExists('shop', env)).toBe(false);
  expect(existsSync(workspace)).toBe(true);

  const back = createGroup('shop', { env });
  const carnet = openGroupCarnet(back, { env });
  expect(carnet.sessions.get(SESSION)?.status).toBe('archived');
  expect(carnet.notes.list()).toHaveLength(1);
  carnet.close();

  const purge = makeIo({ env });
  expect(groupsDrop('shop', purge, { purge: true, isAlive: () => false })).toBe(0);
  expect(purge.output.join('')).toContain('notes deleted: 1');
  expect(existsSync(back.workspace)).toBe(false);
  const empty = openGroupCarnet(createGroup('shop', { env }), { env });
  expect(empty.notes.list()).toHaveLength(0);
  empty.close();
  expect(readFileSync(join(loadGroup('shop', env).source, 'CLAUDE.md'), 'utf8')).toBe('');
});
