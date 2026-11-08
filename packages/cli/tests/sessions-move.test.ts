import { createWorkspace, openCarnet } from '@rucher/carnet';
import { expect, test } from 'vite-plus/test';
import { sessionsMove } from '../src/commands/sessions.ts';
import { makeIo, SESSION, tempDirectory } from './helpers.ts';

function strayShopSession() {
  const api = tempDirectory('repo-api-');
  const env = { RUCHER_HOME: tempDirectory('home-') };
  createWorkspace('shop', { env, repos: [api] });
  createWorkspace('shop-mobile', { env, repos: [api] });
  const source = openCarnet({ workspace: 'shop-mobile', env });
  source.sessions.create({ id: SESSION, kind: 'active', name: 'shop-auth', cwd: api });
  source.agents.start(SESSION, { name: 'login-form', task: 'Add the login form' });
  return { env, source };
}

test('sessions move previews with --dry-run, then moves to the named workspace', () => {
  const { env, source } = strayShopSession();
  const preview = makeIo({ env });
  sessionsMove(source, 'shop-auth', 'shop', preview, { dryRun: true });
  expect(preview.output.join('')).toMatch(/^would move shop-auth from shop-mobile to shop\n/);
  expect(source.sessions.get(SESSION)).toBeDefined();
  const io = makeIo({ env });
  sessionsMove(source, 'shop-auth', 'shop', io);
  expect(io.output.join('')).toMatch(
    /^moved shop-auth from shop-mobile to shop\n {2}agents moved: login-form\n/,
  );
  expect(source.sessions.get(SESSION)?.workspace).toBe('shop');
  expect(source.sessions.list()).toEqual([]);
  source.close();
  const target = openCarnet({ workspace: 'shop', env });
  expect(target.agents.list(SESSION).map((agent) => agent.name)).toEqual(['login-form']);
  target.close();
});

test('sessions move refuses an unknown workspace', () => {
  const { env, source } = strayShopSession();
  expect(() => sessionsMove(source, 'shop-auth', 'blog', makeIo({ env }))).toThrow(
    /No workspace named "blog"/,
  );
  source.close();
});
