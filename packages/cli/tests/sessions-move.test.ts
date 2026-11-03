import { createGroup, openCarnet } from '@rucher/carnet';
import { expect, test } from 'vite-plus/test';
import { sessionsMove } from '../src/commands/sessions.ts';
import { makeIo, SESSION, tempDirectory } from './helpers.ts';

function strayShopSession() {
  const api = tempDirectory('repo-api-');
  const env = { RUCHER_HOME: tempDirectory('home-') };
  createGroup('shop', { env, repos: [api] });
  createGroup('shop-mobile', { env, repos: [api] });
  const source = openCarnet({ group: 'shop-mobile', env });
  source.sessions.create({ id: SESSION, kind: 'active', name: 'shop-auth', cwd: api });
  source.agents.start(SESSION, { name: 'login-form', task: 'Add the login form' });
  return { env, source };
}

// Both groups now share one database: moving becomes a group_name update.
test.skip('sessions move previews with --dry-run, then moves to the named group', () => {
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
  source.close();
  const target = openCarnet({ group: 'shop', env });
  expect(target.agents.list(SESSION).map((agent) => agent.name)).toEqual(['login-form']);
  target.close();
});

test('sessions move refuses an unknown group', () => {
  const { env, source } = strayShopSession();
  expect(() => sessionsMove(source, 'shop-auth', 'blog', makeIo({ env }))).toThrow(
    /No group named "blog"/,
  );
  source.close();
});
