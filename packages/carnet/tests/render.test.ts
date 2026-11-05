import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { createGroup, type Group, loadGroup } from '../src/group/group.ts';
import { renderWorkspace } from '../src/render.ts';
import { GENERATED_MARKER, MARKDOWN_MARKER, mergeSettings } from '../src/workspace-files.ts';
import { tempDirectory, testHome } from './helpers.ts';

function shop(): { group: Group; env: NodeJS.ProcessEnv; api: string } {
  const env = testHome();
  const api = tempDirectory('shop-api-');
  return { group: createGroup('shop', { env, repos: [api] }), env, api };
}

const settingsPath = (group: Group) => join(group.workspace, '.claude', 'settings.json');
const settings = (group: Group) => JSON.parse(readFileSync(settingsPath(group), 'utf8'));

test('render copies the instructions with the marker and generates the settings', () => {
  const { group, api } = shop();
  writeFileSync(join(group.source, 'CLAUDE.md'), 'Shop rules\n@glossary.md\n');
  writeFileSync(join(group.source, 'glossary.md'), 'Cart: a basket\n');
  writeFileSync(join(group.source, 'prompt.md'), 'appended, not copied');
  const result = renderWorkspace(group);
  expect(result).toEqual({
    workspace: group.workspace,
    written: ['CLAUDE.md', 'glossary.md', join('.claude', 'settings.json')],
    removed: [],
  });
  const instructions = join(group.workspace, 'CLAUDE.md');
  expect(lstatSync(instructions).isFile()).toBe(true);
  expect(readFileSync(instructions, 'utf8')).toBe(`${MARKDOWN_MARKER}Shop rules\n@glossary.md\n`);
  expect(readFileSync(join(group.workspace, 'glossary.md'), 'utf8')).toBe(
    `${MARKDOWN_MARKER}Cart: a basket\n`,
  );
  expect(existsSync(join(group.workspace, 'prompt.md'))).toBe(false);
  expect(existsSync(join(group.workspace, 'reports'))).toBe(true);
  expect(settings(group)).toEqual({
    '//': GENERATED_MARKER,
    permissions: {
      additionalDirectories: [api],
      deny: ['Edit(/CLAUDE.md)', 'Edit(/glossary.md)'],
    },
  });
});

test('a second render writes nothing and leaves other workspace files alone', () => {
  const { group } = shop();
  renderWorkspace(group);
  const mine = join(group.workspace, '.claude', 'settings.local.json');
  writeFileSync(mine, '{"mine":true}');
  writeFileSync(join(group.workspace, 'reports', 'cart.md'), 'report');
  writeFileSync(join(group.workspace, 'notes.md'), 'hand-written');
  const before = statSync(settingsPath(group)).mtimeMs;
  expect(renderWorkspace(group)).toEqual({ workspace: group.workspace, written: [], removed: [] });
  expect(statSync(settingsPath(group)).mtimeMs).toBe(before);
  expect(readFileSync(mine, 'utf8')).toBe('{"mine":true}');
  expect(readFileSync(join(group.workspace, 'reports', 'cart.md'), 'utf8')).toBe('report');
  expect(readFileSync(join(group.workspace, 'notes.md'), 'utf8')).toBe('hand-written');
});

test('a source change rewrites its copy, and a removed source file loses its copy', () => {
  const { group } = shop();
  writeFileSync(join(group.source, 'glossary.md'), 'v1');
  renderWorkspace(group);
  writeFileSync(join(group.source, 'glossary.md'), 'v2');
  expect(renderWorkspace(group).written).toEqual(['glossary.md']);
  expect(readFileSync(join(group.workspace, 'glossary.md'), 'utf8')).toBe(`${MARKDOWN_MARKER}v2`);
  rmSync(join(group.source, 'glossary.md'));
  const result = renderWorkspace(group);
  expect(result.removed).toEqual(['glossary.md']);
  expect(result.written).toEqual([join('.claude', 'settings.json')]);
  expect(existsSync(join(group.workspace, 'glossary.md'))).toBe(false);
  expect(settings(group).permissions.deny).toEqual(['Edit(/CLAUDE.md)']);
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
  expect(settings(group).permissions).toEqual({
    additionalDirectories: [api, '/srv/shared'],
    deny: ['Edit(/CLAUDE.md)'],
    allow: ['Bash(pnpm test:*)'],
  });
});

test('render replaces a link left by a previous render and its own files, never hand-written ones', () => {
  const { group } = shop();
  mkdirSync(group.workspace, { recursive: true });
  const instructions = join(group.workspace, 'CLAUDE.md');
  symlinkSync(join(group.source, 'CLAUDE.md'), instructions);
  renderWorkspace(group);
  expect(lstatSync(instructions).isFile()).toBe(true);

  writeFileSync(settingsPath(group), '{"permissions":{}}');
  expect(() => renderWorkspace(group)).toThrowError(/not written by rucher/);
  writeFileSync(settingsPath(group), `{"//":"${GENERATED_MARKER}"}`);
  renderWorkspace(group);
  expect(lstatSync(settingsPath(group)).isFile()).toBe(true);

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
