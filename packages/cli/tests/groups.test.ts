import { readRegistry, registerGroup } from '@rucher/carnet';
import { expect, test } from 'vite-plus/test';
import { init } from '../src/commands/init.ts';
import { groupsForget, groupsList, groupsPrune } from '../src/commands/groups.ts';
import { makeIo, tempDirectory } from './helpers.ts';

function setup() {
  const env = { RUCHER_HOME: tempDirectory('home-') };
  const shop = tempDirectory('meta-shop-');
  const blog = tempDirectory('meta-blog-');
  expect(init({ directory: shop, name: 'shop' }, makeIo({ env }))).toBe(0);
  expect(init({ directory: blog, name: 'blog' }, makeIo({ env }))).toBe(0);
  registerGroup({ name: 'shop', path: '/gone/shop' }, env);
  return { env, shop, blog };
}

test('groups list flags groups whose meta directory is gone, without pruning', () => {
  const { env, shop } = setup();
  const io = makeIo({ env });
  expect(groupsList(io)).toBe(0);
  const lines = io.output.join('').trimEnd().split('\n');
  expect(lines).toHaveLength(3);
  expect(lines.find((line) => line.includes('/gone/shop'))).toMatch(/missing$/);
  expect(lines.find((line) => line.includes(shop))).not.toContain('missing');
  expect(readRegistry(env)).toHaveLength(3);
  expect(groupsList(makeIo({ env: { RUCHER_HOME: tempDirectory('empty-') } }))).toBe(0);
});

test('groups forget by name refuses ambiguous names, works by path', () => {
  const { env, blog } = setup();
  const ambiguous = makeIo({ env });
  expect(groupsForget('shop', ambiguous)).toBe(1);
  expect(ambiguous.errors.join('')).toContain('/gone/shop');
  expect(groupsForget('/gone/shop', makeIo({ env }))).toBe(0);
  expect(groupsForget('blog', makeIo({ env }))).toBe(0);
  expect(readRegistry(env).map((group) => group.name)).toEqual(['shop']);
  expect(readRegistry(env).some((group) => group.path === blog)).toBe(false);
  const unknown = makeIo({ env });
  expect(groupsForget('nope', unknown)).toBe(1);
  expect(unknown.errors.join('')).toContain('no registered group');
});

test('groups prune removes only missing groups', () => {
  const { env } = setup();
  const io = makeIo({ env });
  expect(groupsPrune(io)).toBe(0);
  expect(io.output.join('')).toContain('pruned 1:');
  expect(readRegistry(env).map((group) => group.path)).not.toContain('/gone/shop');
  expect(readRegistry(env)).toHaveLength(2);
  const again = makeIo({ env });
  expect(groupsPrune(again)).toBe(0);
  expect(again.output.join('')).toBe('nothing to prune\n');
});
