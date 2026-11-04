import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { createGroup, type Group, loadGroup } from '../src/group/group.ts';
import { renderWorkspace } from '../src/render.ts';
import { GENERATED_MARKER, mergeSettings } from '../src/workspace-files.ts';
import { tempDirectory, testHome } from './helpers.ts';

function shop(): { group: Group; env: NodeJS.ProcessEnv; api: string } {
  const env = testHome();
  const api = tempDirectory('shop-api-');
  return { group: createGroup('shop', { env, repos: [api] }), env, api };
}

const settingsPath = (group: Group) => join(group.workspace, '.claude', 'settings.json');

test('render links the instructions to the source and generates the settings', () => {
  const { group, api } = shop();
  const result = renderWorkspace(group);
  expect(result).toEqual({
    workspace: group.workspace,
    written: [join('.claude', 'settings.json')],
    linked: ['CLAUDE.md'],
  });
  expect(readlinkSync(join(group.workspace, 'CLAUDE.md'))).toBe(join(group.source, 'CLAUDE.md'));
  expect(existsSync(join(group.workspace, 'reports'))).toBe(true);
  expect(JSON.parse(readFileSync(settingsPath(group), 'utf8'))).toEqual({
    '//': GENERATED_MARKER,
    permissions: { additionalDirectories: [api] },
  });
});

test('a second render writes nothing and leaves other workspace files alone', () => {
  const { group } = shop();
  renderWorkspace(group);
  const mine = join(group.workspace, '.claude', 'settings.local.json');
  writeFileSync(mine, '{"mine":true}');
  writeFileSync(join(group.workspace, 'reports', 'cart.md'), 'report');
  const before = statSync(settingsPath(group)).mtimeMs;
  expect(renderWorkspace(group)).toEqual({ workspace: group.workspace, written: [], linked: [] });
  expect(statSync(settingsPath(group)).mtimeMs).toBe(before);
  expect(readFileSync(mine, 'utf8')).toBe('{"mine":true}');
  expect(readFileSync(join(group.workspace, 'reports', 'cart.md'), 'utf8')).toBe('report');
});

test('backend settings merge over the generated ones', () => {
  const { group, env, api } = shop();
  const file = join(group.source, 'group.json');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.backends = {
    'claude-code': {
      settings: {
        permissions: { allow: ['Bash(pnpm test:*)'], additionalDirectories: ['/srv/shared'] },
      },
    },
  };
  writeFileSync(file, JSON.stringify(data));
  renderWorkspace(loadGroup('shop', env));
  expect(JSON.parse(readFileSync(settingsPath(group), 'utf8')).permissions).toEqual({
    additionalDirectories: [api, '/srv/shared'],
    allow: ['Bash(pnpm test:*)'],
  });
});

test('render replaces stale links and its own files, never hand-written ones', () => {
  const { group } = shop();
  mkdirSync(group.workspace, { recursive: true });
  symlinkSync('/old/source/CLAUDE.md', join(group.workspace, 'CLAUDE.md'));
  renderWorkspace(group);
  expect(readlinkSync(join(group.workspace, 'CLAUDE.md'))).toBe(join(group.source, 'CLAUDE.md'));

  writeFileSync(settingsPath(group), '{"permissions":{}}');
  expect(() => renderWorkspace(group)).toThrowError(/not written by rucher/);
  writeFileSync(settingsPath(group), `{"//":"${GENERATED_MARKER}"}`);
  renderWorkspace(group);
  expect(lstatSync(settingsPath(group)).isFile()).toBe(true);

  const instructions = join(group.workspace, 'CLAUDE.md');
  writeFileSync(join(group.source, 'CLAUDE.md'), 'source');
  expect(readFileSync(instructions, 'utf8')).toBe('source');
  rmSync(instructions);
  writeFileSync(instructions, 'hand-written');
  expect(() => renderWorkspace(group)).toThrowError(/not written by rucher/);
  expect(readFileSync(instructions, 'utf8')).toBe('hand-written');
});

test('settings merge concatenates arrays without duplicates and nests objects', () => {
  expect(
    mergeSettings(
      { permissions: { allow: ['a'], deny: ['x'] }, model: 'sonnet' },
      { permissions: { allow: ['a', 'b'] }, model: 'opus', env: { A: '1' } },
    ),
  ).toEqual({ permissions: { allow: ['a', 'b'], deny: ['x'] }, model: 'opus', env: { A: '1' } });
});
