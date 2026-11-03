import { initGroup, openCarnet } from '@rucher/carnet';
import { expect, test } from 'vite-plus/test';
import { sessionsMove } from '../src/commands/sessions.ts';
import { makeIo, SESSION, tempDirectory } from './helpers.ts';

function strayShopSession() {
  const api = tempDirectory('repo-api-');
  const shop = tempDirectory('meta-');
  const shopMobile = tempDirectory('meta-');
  const env = { RUCHER_HOME: tempDirectory('home-') };
  initGroup(shop, { env, name: 'shop', repos: [api] });
  initGroup(shopMobile, { env, name: 'shop-mobile', repos: [api] });
  const source = openCarnet({ cwd: shopMobile, env });
  source.sessions.create({ id: SESSION, kind: 'active', name: 'shop-auth', cwd: api });
  source.agents.start(SESSION, { name: 'login-form', task: 'Add the login form' });
  return { shop, shopMobile, env, source };
}

test('sessions move previews with --dry-run, then moves to the named group', () => {
  const { shop, env, source } = strayShopSession();
  const preview = makeIo({ env });
  sessionsMove(source, 'shop-auth', 'shop', preview, { dryRun: true });
  expect(preview.output.join('')).toMatch(/^would move shop-auth from shop-mobile to shop\n/);
  expect(source.sessions.get(SESSION)).toBeDefined();
  const io = makeIo({ env });
  sessionsMove(source, 'shop-auth', 'shop', io);
  expect(io.output.join('')).toMatch(
    /^moved shop-auth from shop-mobile to shop\n {2}agents moved: login-form\n/,
  );
  expect(source.sessions.get(SESSION)).toBeUndefined();
  source.close();
  const target = openCarnet({ cwd: shop, env });
  expect(target.agents.list(SESSION).map((agent) => agent.name)).toEqual(['login-form']);
  target.close();
});

test('sessions move names the target group by path too, and refuses an unknown one', () => {
  const { shop, env, source } = strayShopSession();
  expect(() => sessionsMove(source, 'shop-auth', 'blog', makeIo({ env }))).toThrow(
    /No registered group named "blog"/,
  );
  sessionsMove(source, 'shop-auth', shop, makeIo({ env }));
  expect(source.sessions.get(SESSION)).toBeUndefined();
  source.close();
});
