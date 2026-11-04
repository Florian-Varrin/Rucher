import { lstatSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { databasePath, GENERATED_MARKER, loadGroup } from '@rucher/carnet';
import { groupAdd, groupRemove, groupShow, groupSync } from '../src/commands/group.ts';
import { init } from '../src/commands/init.ts';
import { makeIo, tempDirectory } from './helpers.ts';

function setup() {
  const api = tempDirectory('repo-api-');
  const web = tempDirectory('repo-web-');
  const env = { RUCHER_HOME: tempDirectory('home-') };
  const workspace = join(env.RUCHER_HOME, 'data', 'workspaces', 'shop');
  const source = join(env.RUCHER_HOME, 'config', 'groups', 'shop');
  return { workspace, source, api, web, env, io: makeIo({ env }) };
}

function settingsOf(workspace: string) {
  return JSON.parse(readFileSync(join(workspace, '.claude', 'settings.json'), 'utf8'));
}

test('init renders the workspace: instructions linked to the source, settings generated', () => {
  const { workspace, source, api, web, io } = setup();
  expect(init({ name: 'shop', repos: [api, web] }, io)).toBe(0);
  expect(io.output.join('')).toContain('shop created');
  expect(io.output.join('')).toContain('written .claude/settings.json');
  expect(io.output.join('')).toContain(databasePath(io.env));
  expect(loadGroup('shop', io.env).workspace).toBe(workspace);
  expect(lstatSync(join(workspace, 'CLAUDE.md')).isSymbolicLink()).toBe(true);
  expect(readlinkSync(join(workspace, 'CLAUDE.md'))).toBe(join(source, 'CLAUDE.md'));
  expect(settingsOf(workspace)).toEqual({
    '//': GENERATED_MARKER,
    permissions: { additionalDirectories: [api, web] },
  });
});

test('init without repos still renders and points at group add', () => {
  const { workspace, io } = setup();
  expect(init({ name: 'shop' }, io)).toBe(0);
  expect(io.output.join('')).toContain('rucher group add <path>');
  expect(settingsOf(workspace).permissions.additionalDirectories).toEqual([]);
});

test('group add and remove re-render the settings from group.json', () => {
  const { workspace, source, api, web, io, env } = setup();
  expect(init({ name: 'shop', repos: [api] }, io)).toBe(0);
  writeFileSync(join(source, 'CLAUDE.md'), 'mine\n');

  const addIo = makeIo({ cwd: workspace, env });
  expect(groupAdd(web, addIo)).toBe(0);
  expect(addIo.output.join('')).toContain('written .claude/settings.json');
  expect(readFileSync(join(workspace, 'CLAUDE.md'), 'utf8')).toBe('mine\n');
  expect(settingsOf(workspace).permissions.additionalDirectories).toEqual([api, web]);

  const fromRepo = makeIo({ cwd: web, env });
  expect(groupShow(fromRepo)).toBe(0);
  expect(fromRepo.output.join('')).toContain(web);

  const removeIo = makeIo({ cwd: workspace, env });
  expect(groupRemove(api, removeIo)).toBe(0);
  expect(settingsOf(workspace).permissions.additionalDirectories).toEqual([web]);

  const bad = makeIo({ cwd: workspace, env });
  expect(groupAdd(join(workspace, 'missing'), bad)).toBe(1);
  expect(bad.errors.join('')).toContain('does not exist');
  expect(init({ name: 'shop' }, makeIo({ cwd: workspace, env }))).toBe(1);
});

test('group sync rewrites edited settings and is a no-op when in sync', () => {
  const { workspace, api, io, env } = setup();
  expect(init({ name: 'shop', repos: [api] }, io)).toBe(0);
  const settingsPath = join(workspace, '.claude', 'settings.json');
  writeFileSync(
    settingsPath,
    JSON.stringify({ '//': GENERATED_MARKER, permissions: { additionalDirectories: [] } }),
  );
  const syncIo = makeIo({ cwd: workspace, env });
  expect(groupSync(syncIo)).toBe(0);
  expect(syncIo.output.join('')).toContain('written .claude/settings.json');
  expect(settingsOf(workspace).permissions.additionalDirectories).toEqual([api]);
  const noop = makeIo({ cwd: workspace, env });
  expect(groupSync(noop)).toBe(0);
  expect(noop.output.join('')).toContain('already in sync');
});
