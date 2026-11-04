import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGroup, loadGroup } from '@rucher/carnet';
import { expect, test } from 'vite-plus/test';
import {
  groupAdd,
  groupEdit,
  groupPath,
  groupRemove,
  groupShow,
  groupSync,
} from '../src/commands/group.ts';
import { makeIo, tempDirectory } from './helpers.ts';

function setup() {
  const env = { RUCHER_HOME: tempDirectory('home-') };
  const api = tempDirectory('shop-api-');
  const web = tempDirectory('shop-web-');
  const group = createGroup('shop', { env, repos: [api] });
  return { env, api, web, group };
}

test('group show names the group, its source, workspace and repos', () => {
  const { env, api, group } = setup();
  const io = makeIo({ env, cwd: api });
  expect(groupShow(io)).toBe(0);
  const output = io.output.join('');
  expect(output).toContain(`source: ${group.source}`);
  expect(output).toContain(`workspace: ${group.workspace}`);
  expect(output).toContain(api);
  const outside = makeIo({ env });
  expect(groupShow(outside)).toBe(1);
  expect(outside.errors.join('')).toContain('error:');
});

test('the group comes from -g first, and a guess from the directory is said on stderr', () => {
  const { env, api } = setup();
  createGroup('blog', { env });
  const fromRepo = makeIo({ env, cwd: api });
  expect(groupPath(fromRepo)).toBe(0);
  expect(fromRepo.errors.join('')).toMatch(/^group shop \(from shop-api-/);
  const named = makeIo({ env, cwd: api });
  expect(groupPath(named, { group: 'blog' })).toBe(0);
  expect(named.output.join('')).toBe(`${loadGroup('blog', env).workspace}\n`);
  expect(named.errors).toEqual([]);
  const fromEnv = makeIo({ env: { ...env, RUCHER_GROUP: 'blog' }, cwd: api });
  expect(groupPath(fromEnv)).toBe(0);
  expect(fromEnv.output.join('')).toContain('blog');
  expect(fromEnv.errors).toEqual([]);
  const fromWorkspace = makeIo({ env, cwd: loadGroup('shop', env).workspace });
  expect(groupPath(fromWorkspace, { source: true })).toBe(0);
  expect(fromWorkspace.output.join('')).toBe(`${loadGroup('shop', env).source}\n`);
  expect(fromWorkspace.errors.join('')).toBe('group shop (from its workspace)\n');
});

test('group add and remove change group.json and render the workspace', () => {
  const { env, api, web } = setup();
  const add = makeIo({ env });
  expect(groupAdd(web, add, { group: 'shop' })).toBe(0);
  expect(add.output.join('')).toMatch(/^added shop-web-/);
  expect(loadGroup('shop', env).repos.map((repo) => repo.path)).toEqual([api, web]);
  const remove = makeIo({ env });
  expect(groupRemove(api, remove, { group: 'shop' })).toBe(0);
  expect(loadGroup('shop', env).repos.map((repo) => repo.path)).toEqual([web]);
  const again = makeIo({ env });
  expect(groupRemove(api, again, { group: 'shop' })).toBe(1);
  expect(again.errors.join('')).toContain('is not a repo of');
});

test('group sync renders, then reports nothing to do', () => {
  const { env } = setup();
  const first = makeIo({ env });
  expect(groupSync(first, { group: 'shop' })).toBe(0);
  const second = makeIo({ env });
  expect(groupSync(second, { group: 'shop' })).toBe(0);
  expect(second.output.join('')).toBe('shop already in sync\n');
});

test('group edit opens the instructions, then syncs', async () => {
  const { env, group } = setup();
  const io = makeIo({ env });
  const opened: string[] = [];
  const code = await groupEdit(io, {
    group: 'shop',
    openEditor: (file) => {
      opened.push(file);
      writeFileSync(file, '# shop\n');
      return 0;
    },
  });
  expect(code).toBe(0);
  expect(opened).toEqual([join(group.source, 'CLAUDE.md')]);
  expect(readFileSync(join(group.source, 'CLAUDE.md'), 'utf8')).toBe('# shop\n');
});

test('group edit --json restores an invalid group.json unless asked to edit again', async () => {
  const { env, group } = setup();
  const file = join(group.source, 'group.json');
  const original = readFileSync(file, 'utf8');
  const io = makeIo({ env });
  const aborted = await groupEdit(io, {
    group: 'shop',
    json: true,
    openEditor: (path) => {
      writeFileSync(path, '{ broken');
      return 0;
    },
    confirm: async () => false,
  });
  expect(aborted).toBe(1);
  expect(io.errors.join('')).toContain('group.json is invalid');
  expect(readFileSync(file, 'utf8')).toBe(original);

  let round = 0;
  const fixed = await groupEdit(makeIo({ env }), {
    group: 'shop',
    json: true,
    openEditor: (path) => {
      round += 1;
      writeFileSync(path, round === 1 ? '{ broken' : original);
      return 0;
    },
    confirm: async () => true,
  });
  expect(fixed).toBe(0);
  expect(round).toBe(2);

  const failing = makeIo({ env });
  expect(await groupEdit(failing, { group: 'shop', openEditor: () => 1 })).toBe(1);
  expect(failing.errors.join('')).toContain('exited with an error');
});
