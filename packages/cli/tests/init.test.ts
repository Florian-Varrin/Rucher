import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { databasePath, loadGroup } from '@rucher/carnet';
import { groupAdd, groupRemove, groupShow, groupSync } from '../src/commands/group.ts';
import { init } from '../src/commands/init.ts';
import { makeIo, tempDirectory } from './helpers.ts';

function setup() {
  const api = tempDirectory('repo-api-');
  const web = tempDirectory('repo-web-');
  const env = { RUCHER_HOME: tempDirectory('home-') };
  const meta = join(env.RUCHER_HOME, 'data', 'workspaces', 'shop');
  return { meta, api, web, env, io: makeIo({ env }) };
}

function settingsOf(meta: string) {
  return JSON.parse(readFileSync(join(meta, '.claude', 'settings.json'), 'utf8'));
}

test('init with repos writes the group, the CLAUDE.md template and the settings', () => {
  const { meta, api, web, io } = setup();
  expect(init({ name: 'shop', repos: [api, web] }, io)).toBe(0);
  expect(io.output.join('')).toContain('shop created');
  expect(io.output.join('')).toContain('written .claude/settings.json');
  expect(io.output.join('')).toContain(databasePath(io.env));
  expect(loadGroup('shop', io.env).workspace).toBe(meta);
  const claudeMd = readFileSync(join(meta, 'CLAUDE.md'), 'utf8');
  expect(claudeMd).toContain('# shop');
  expect(claudeMd).toContain(`: ${api}`);
  expect(settingsOf(meta)).toEqual({ permissions: { additionalDirectories: [api, web] } });
});

test('init without repos writes no settings and points at group add', () => {
  const { meta, io } = setup();
  expect(init({ name: 'shop' }, io)).toBe(0);
  expect(io.output.join('')).toContain('rucher group add <path>');
  expect(existsSync(join(meta, '.claude', 'settings.json'))).toBe(false);
  expect(readFileSync(join(meta, 'CLAUDE.md'), 'utf8')).toContain('none yet');
});

test('group add refreshes the repos block of a generated CLAUDE.md', () => {
  const { meta, api, web, io, env } = setup();
  expect(init({ name: 'shop', repos: [api] }, io)).toBe(0);
  const path = join(meta, 'CLAUDE.md');
  writeFileSync(path, `${readFileSync(path, 'utf8')}\n## Mine\n\nkeep this\n`);
  const addIo = makeIo({ cwd: meta, env });
  expect(groupAdd(web, addIo)).toBe(0);
  expect(addIo.output.join('')).toContain('updated CLAUDE.md');
  const content = readFileSync(path, 'utf8');
  expect(content).toContain(`: ${api}`);
  expect(content).toContain(`: ${web}`);
  expect(content).toContain('## Mine\n\nkeep this');
  expect(content.match(/<!-- rucher:repos start -->/g)).toHaveLength(1);
  expect(groupAdd(web, makeIo({ cwd: meta, env })).valueOf()).toBe(0);
});

test('group add extends group.json and merges into existing settings', () => {
  const { meta, api, web, io, env } = setup();
  expect(init({ name: 'shop', repos: [api] }, io)).toBe(0);
  writeFileSync(join(meta, 'CLAUDE.md'), 'mine\n');
  const settings = settingsOf(meta);
  settings.permissions.allow = ['Bash(ls)'];
  writeFileSync(join(meta, '.claude', 'settings.json'), JSON.stringify(settings));

  const addIo = makeIo({ cwd: meta, env });
  expect(groupAdd(web, addIo)).toBe(0);
  expect(addIo.output.join('')).toContain('updated .claude/settings.json');
  expect(addIo.output.join('')).toContain('no rucher:repos markers');
  expect(readFileSync(join(meta, 'CLAUDE.md'), 'utf8')).toBe('mine\n');
  expect(settingsOf(meta)).toEqual({
    permissions: { additionalDirectories: [api, web], allow: ['Bash(ls)'] },
  });

  const fromRepo = makeIo({ cwd: web, env });
  expect(groupShow(fromRepo)).toBe(0);
  expect(fromRepo.output.join('')).toContain(web);

  const bad = makeIo({ cwd: meta, env });
  expect(groupAdd(join(meta, 'missing'), bad)).toBe(1);
  expect(bad.errors.join('')).toContain('does not exist');
  expect(init({ name: 'shop' }, makeIo({ cwd: meta, env }))).toBe(1);
});

test('group remove and group sync rewrite settings and CLAUDE.md from group.json', () => {
  const { meta, api, web, io, env } = setup();
  expect(init({ name: 'shop', repos: [api, web] }, io)).toBe(0);
  const settingsPath = join(meta, '.claude', 'settings.json');
  const settings = settingsOf(meta);
  settings.permissions.allow = ['Bash(ls)'];
  settings.permissions.additionalDirectories.push('/elsewhere');
  writeFileSync(settingsPath, JSON.stringify(settings));

  const removeIo = makeIo({ cwd: meta, env });
  expect(groupRemove(api, removeIo)).toBe(0);
  expect(removeIo.output.join('')).toContain('updated .claude/settings.json, updated CLAUDE.md');
  expect(settingsOf(meta)).toEqual({
    permissions: { additionalDirectories: [web], allow: ['Bash(ls)'] },
  });
  expect(readFileSync(join(meta, 'CLAUDE.md'), 'utf8')).not.toContain(api);

  const again = makeIo({ cwd: meta, env });
  expect(groupRemove(api, again)).toBe(1);
  expect(again.errors.join('')).toContain('is not a repo of');

  writeFileSync(settingsPath, JSON.stringify({ permissions: { additionalDirectories: [] } }));
  const syncIo = makeIo({ cwd: meta, env });
  expect(groupSync(syncIo)).toBe(0);
  expect(syncIo.output.join('')).toContain('updated .claude/settings.json');
  expect(settingsOf(meta).permissions.additionalDirectories).toEqual([web]);
  const noop = makeIo({ cwd: meta, env });
  expect(groupSync(noop)).toBe(0);
  expect(noop.output.join('')).toContain('already in sync');
});
