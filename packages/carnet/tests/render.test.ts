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
import { createGroup, type Group, loadGroup, sourceInstructions } from '../src/group/group.ts';
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

function agentsGroup(): { group: Group; env: NodeJS.ProcessEnv; api: string } {
  const made = shop();
  rmSync(join(made.group.source, 'CLAUDE.md'));
  writeFileSync(join(made.group.source, 'AGENTS.md'), 'Shop rules\n@glossary.md\n');
  writeFileSync(join(made.group.source, 'glossary.md'), 'Cart: a basket\n');
  return made;
}

const workspaceFile = (group: Group, name: string) =>
  readFileSync(join(group.workspace, name), 'utf8');

test('an AGENTS.md source renders a copy and a generated CLAUDE.md importing it', () => {
  const { group } = agentsGroup();
  expect(renderWorkspace(group).written).toEqual([
    'AGENTS.md',
    'CLAUDE.md',
    'glossary.md',
    join('.claude', 'settings.json'),
  ]);
  expect(workspaceFile(group, 'AGENTS.md')).toBe(`${MARKDOWN_MARKER}Shop rules\n@glossary.md\n`);
  expect(workspaceFile(group, 'CLAUDE.md')).toBe(`${MARKDOWN_MARKER}@AGENTS.md\n`);
  expect(settings(group).permissions.deny).toEqual([
    'Edit(/AGENTS.md)',
    'Edit(/CLAUDE.md)',
    'Edit(/glossary.md)',
  ]);
  expect(renderWorkspace(group).written).toEqual([]);
});

test('backends/claude.md is copied, imported and denied, then removed with its source', () => {
  const { group } = agentsGroup();
  mkdirSync(join(group.source, 'backends'));
  writeFileSync(join(group.source, 'backends', 'claude.md'), 'Claude only\n');
  renderWorkspace(group);
  expect(workspaceFile(group, 'backends/claude.md')).toBe(`${MARKDOWN_MARKER}Claude only\n`);
  expect(workspaceFile(group, 'CLAUDE.md')).toBe(
    `${MARKDOWN_MARKER}@AGENTS.md\n@backends/claude.md\n`,
  );
  expect(settings(group).permissions.deny).toContain('Edit(/backends/claude.md)');
  rmSync(join(group.source, 'backends', 'claude.md'));
  const result = renderWorkspace(group);
  expect(result.removed).toEqual([join('backends', 'claude.md')]);
  expect(existsSync(join(group.workspace, 'backends'))).toBe(false);
  expect(workspaceFile(group, 'CLAUDE.md')).toBe(`${MARKDOWN_MARKER}@AGENTS.md\n`);
});

test('a hand-written file in the workspace backends folder stays', () => {
  const { group } = agentsGroup();
  mkdirSync(join(group.workspace, 'backends'), { recursive: true });
  writeFileSync(join(group.workspace, 'backends', 'mine.md'), 'hand-written');
  expect(renderWorkspace(group).removed).toEqual([]);
  expect(existsSync(join(group.workspace, 'backends', 'mine.md'))).toBe(true);
});

test('backends/claude.md is ignored with a CLAUDE.md source', () => {
  const { group } = shop();
  mkdirSync(join(group.source, 'backends'));
  writeFileSync(join(group.source, 'backends', 'claude.md'), 'Claude only\n');
  renderWorkspace(group);
  expect(existsSync(join(group.workspace, 'backends'))).toBe(false);
});

test('a repo with only an AGENTS.md is imported, checked on every render', () => {
  const { group, api } = agentsGroup();
  writeFileSync(join(api, 'AGENTS.md'), 'API rules\n');
  renderWorkspace(group);
  expect(workspaceFile(group, 'CLAUDE.md')).toBe(
    `${MARKDOWN_MARKER}@AGENTS.md\n@${join(api, 'AGENTS.md')}\n`,
  );
  writeFileSync(join(api, 'CLAUDE.md'), 'API rules for Claude\n');
  expect(renderWorkspace(group).written).toEqual(['CLAUDE.md']);
  expect(workspaceFile(group, 'CLAUDE.md')).toBe(`${MARKDOWN_MARKER}@AGENTS.md\n`);
});

test('both AGENTS.md and CLAUDE.md in the source is an error naming the file to remove', () => {
  const { group } = shop();
  writeFileSync(join(group.source, 'AGENTS.md'), 'rules');
  expect(() => renderWorkspace(group)).toThrow(/both AGENTS\.md and CLAUDE\.md.*remove CLAUDE\.md/);
  expect(() => sourceInstructions(group)).toThrow(
    expect.objectContaining({ code: 'GROUP_INSTRUCTIONS_CONFLICT' }),
  );
});

test('switching the source between CLAUDE.md and AGENTS.md re-renders both ways', () => {
  const { group } = shop();
  writeFileSync(join(group.source, 'CLAUDE.md'), 'Shop rules\n');
  renderWorkspace(group);
  rmSync(join(group.source, 'CLAUDE.md'));
  writeFileSync(join(group.source, 'AGENTS.md'), 'Shop rules\n');
  renderWorkspace(group);
  expect(workspaceFile(group, 'CLAUDE.md')).toBe(`${MARKDOWN_MARKER}@AGENTS.md\n`);
  rmSync(join(group.source, 'AGENTS.md'));
  writeFileSync(join(group.source, 'CLAUDE.md'), 'Shop rules\n');
  const result = renderWorkspace(group);
  expect(result.removed).toEqual(['AGENTS.md']);
  expect(workspaceFile(group, 'CLAUDE.md')).toBe(`${MARKDOWN_MARKER}Shop rules\n`);
  expect(existsSync(join(group.workspace, 'AGENTS.md'))).toBe(false);
});

test('a hand-written AGENTS.md or CLAUDE.md in the workspace is refused', () => {
  const { group } = agentsGroup();
  writeFileSync(join(group.workspace, 'AGENTS.md'), 'hand-written');
  expect(() => renderWorkspace(group)).toThrow(
    expect.objectContaining({ code: 'WORKSPACE_FILE_CONFLICT' }),
  );
  rmSync(join(group.workspace, 'AGENTS.md'));
  writeFileSync(join(group.workspace, 'CLAUDE.md'), 'hand-written');
  expect(() => renderWorkspace(group)).toThrow(
    expect.objectContaining({ code: 'WORKSPACE_FILE_CONFLICT' }),
  );
});
