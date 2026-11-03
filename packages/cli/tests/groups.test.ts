import { createGroup } from '@rucher/carnet';
import { expect, test } from 'vite-plus/test';
import { groupsList } from '../src/commands/groups.ts';
import { makeIo, tempDirectory } from './helpers.ts';

test('groups list shows each group with its repo count and workspace', () => {
  const env = { RUCHER_HOME: tempDirectory('home-') };
  createGroup('shop', { env, repos: [tempDirectory('shop-api-')] });
  const blog = createGroup('blog', { env });
  const io = makeIo({ env });
  expect(groupsList(io)).toBe(0);
  const lines = io.output.join('').trimEnd().split('\n');
  expect(lines).toHaveLength(2);
  expect(lines[0]).toBe(`blog  0 repos  ${blog.workspace}`);
  expect(lines[1]).toMatch(/^shop  1 repo  /);
  const empty = makeIo({ env: { RUCHER_HOME: tempDirectory('empty-') } });
  expect(groupsList(empty)).toBe(0);
  expect(empty.output.join('')).toBe('no group yet\n');
});
