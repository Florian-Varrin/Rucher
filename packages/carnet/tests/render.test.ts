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
import { createGroup, type Group, loadGroup, definitionInstructions } from '../src/group/group.ts';
import { renderRunDirectory } from '../src/render.ts';
import { GENERATED_MARKER, MARKDOWN_MARKER, mergeSettings } from '../src/run-directory-files.ts';
import { tempDirectory, testHome } from './helpers.ts';

function shop(): { group: Group; env: NodeJS.ProcessEnv; api: string } {
  const env = testHome();
  const api = tempDirectory('shop-api-');
  return { group: createGroup('shop', { env, repos: [api] }), env, api };
}

const settingsPath = (group: Group) => join(group.runDirectory, '.claude', 'settings.json');
const settings = (group: Group) => JSON.parse(readFileSync(settingsPath(group), 'utf8'));

test('render copies the instructions with the marker and generates the settings', () => {
  const { group, api } = shop();
  writeFileSync(join(group.definition, 'CLAUDE.md'), 'Shop rules\n@glossary.md\n');
  writeFileSync(join(group.definition, 'glossary.md'), 'Cart: a basket\n');
  writeFileSync(join(group.definition, 'prompt.md'), 'appended, not copied');
  const result = renderRunDirectory(group);
  expect(result).toEqual({
    runDirectory: group.runDirectory,
    written: ['CLAUDE.md', 'glossary.md', join('.claude', 'settings.json')],
    removed: [],
  });
  const instructions = join(group.runDirectory, 'CLAUDE.md');
  expect(lstatSync(instructions).isFile()).toBe(true);
  expect(readFileSync(instructions, 'utf8')).toBe(`${MARKDOWN_MARKER}Shop rules\n@glossary.md\n`);
  expect(readFileSync(join(group.runDirectory, 'glossary.md'), 'utf8')).toBe(
    `${MARKDOWN_MARKER}Cart: a basket\n`,
  );
  expect(existsSync(join(group.runDirectory, 'prompt.md'))).toBe(false);
  expect(existsSync(join(group.runDirectory, 'reports'))).toBe(true);
  expect(settings(group)).toEqual({
    '//': GENERATED_MARKER,
    permissions: {
      additionalDirectories: [api],
      deny: ['Edit(/CLAUDE.md)', 'Edit(/glossary.md)'],
    },
  });
});

test('a second render writes nothing and leaves other run directory files alone', () => {
  const { group } = shop();
  renderRunDirectory(group);
  const mine = join(group.runDirectory, '.claude', 'settings.local.json');
  writeFileSync(mine, '{"mine":true}');
  writeFileSync(join(group.runDirectory, 'reports', 'cart.md'), 'report');
  writeFileSync(join(group.runDirectory, 'notes.md'), 'hand-written');
  const before = statSync(settingsPath(group)).mtimeMs;
  expect(renderRunDirectory(group)).toEqual({
    runDirectory: group.runDirectory,
    written: [],
    removed: [],
  });
  expect(statSync(settingsPath(group)).mtimeMs).toBe(before);
  expect(readFileSync(mine, 'utf8')).toBe('{"mine":true}');
  expect(readFileSync(join(group.runDirectory, 'reports', 'cart.md'), 'utf8')).toBe('report');
  expect(readFileSync(join(group.runDirectory, 'notes.md'), 'utf8')).toBe('hand-written');
});

test('a definition change rewrites its copy, and a removed definition file loses its copy', () => {
  const { group } = shop();
  writeFileSync(join(group.definition, 'glossary.md'), 'v1');
  renderRunDirectory(group);
  writeFileSync(join(group.definition, 'glossary.md'), 'v2');
  expect(renderRunDirectory(group).written).toEqual(['glossary.md']);
  expect(readFileSync(join(group.runDirectory, 'glossary.md'), 'utf8')).toBe(
    `${MARKDOWN_MARKER}v2`,
  );
  rmSync(join(group.definition, 'glossary.md'));
  const result = renderRunDirectory(group);
  expect(result.removed).toEqual(['glossary.md']);
  expect(result.written).toEqual([join('.claude', 'settings.json')]);
  expect(existsSync(join(group.runDirectory, 'glossary.md'))).toBe(false);
  expect(settings(group).permissions.deny).toEqual(['Edit(/CLAUDE.md)']);
});

test('backend settings merge over the generated ones', () => {
  const { group, env, api } = shop();
  const file = join(group.definition, 'group.json');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.backends = {
    'claude-code': {
      settings: {
        permissions: { allow: ['Bash(pnpm test:*)'], additionalDirectories: ['/srv/shared'] },
      },
    },
  };
  writeFileSync(file, JSON.stringify(data));
  renderRunDirectory(loadGroup('shop', env));
  expect(settings(group).permissions).toEqual({
    additionalDirectories: [api, '/srv/shared'],
    deny: ['Edit(/CLAUDE.md)'],
    allow: ['Bash(pnpm test:*)'],
  });
});

test('render replaces a link left by a previous render and its own files, never hand-written ones', () => {
  const { group } = shop();
  mkdirSync(group.runDirectory, { recursive: true });
  const instructions = join(group.runDirectory, 'CLAUDE.md');
  symlinkSync(join(group.definition, 'CLAUDE.md'), instructions);
  renderRunDirectory(group);
  expect(lstatSync(instructions).isFile()).toBe(true);

  writeFileSync(settingsPath(group), '{"permissions":{}}');
  expect(() => renderRunDirectory(group)).toThrowError(/not written by rucher/);
  writeFileSync(settingsPath(group), `{"//":"${GENERATED_MARKER}"}`);
  renderRunDirectory(group);
  expect(lstatSync(settingsPath(group)).isFile()).toBe(true);

  rmSync(instructions);
  writeFileSync(instructions, 'hand-written');
  expect(() => renderRunDirectory(group)).toThrowError(/not written by rucher/);
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
  rmSync(join(made.group.definition, 'CLAUDE.md'));
  writeFileSync(join(made.group.definition, 'AGENTS.md'), 'Shop rules\n@glossary.md\n');
  writeFileSync(join(made.group.definition, 'glossary.md'), 'Cart: a basket\n');
  return made;
}

const runDirectoryFile = (group: Group, name: string) =>
  readFileSync(join(group.runDirectory, name), 'utf8');

test('an AGENTS.md definition renders a copy and a generated CLAUDE.md importing it', () => {
  const { group } = agentsGroup();
  expect(renderRunDirectory(group).written).toEqual([
    'AGENTS.md',
    'CLAUDE.md',
    'glossary.md',
    join('.claude', 'settings.json'),
  ]);
  expect(runDirectoryFile(group, 'AGENTS.md')).toBe(`${MARKDOWN_MARKER}Shop rules\n@glossary.md\n`);
  expect(runDirectoryFile(group, 'CLAUDE.md')).toBe(`${MARKDOWN_MARKER}@AGENTS.md\n`);
  expect(settings(group).permissions.deny).toEqual([
    'Edit(/AGENTS.md)',
    'Edit(/CLAUDE.md)',
    'Edit(/glossary.md)',
  ]);
  expect(renderRunDirectory(group).written).toEqual([]);
});

test('backends/claude.md is copied, imported and denied, then removed with its definition', () => {
  const { group } = agentsGroup();
  mkdirSync(join(group.definition, 'backends'));
  writeFileSync(join(group.definition, 'backends', 'claude.md'), 'Claude only\n');
  renderRunDirectory(group);
  expect(runDirectoryFile(group, 'backends/claude.md')).toBe(`${MARKDOWN_MARKER}Claude only\n`);
  expect(runDirectoryFile(group, 'CLAUDE.md')).toBe(
    `${MARKDOWN_MARKER}@AGENTS.md\n@backends/claude.md\n`,
  );
  expect(settings(group).permissions.deny).toContain('Edit(/backends/claude.md)');
  rmSync(join(group.definition, 'backends', 'claude.md'));
  const result = renderRunDirectory(group);
  expect(result.removed).toEqual([join('backends', 'claude.md')]);
  expect(existsSync(join(group.runDirectory, 'backends'))).toBe(false);
  expect(runDirectoryFile(group, 'CLAUDE.md')).toBe(`${MARKDOWN_MARKER}@AGENTS.md\n`);
});

test('a hand-written file in the run directory backends folder stays', () => {
  const { group } = agentsGroup();
  mkdirSync(join(group.runDirectory, 'backends'), { recursive: true });
  writeFileSync(join(group.runDirectory, 'backends', 'mine.md'), 'hand-written');
  expect(renderRunDirectory(group).removed).toEqual([]);
  expect(existsSync(join(group.runDirectory, 'backends', 'mine.md'))).toBe(true);
});

test('backends/claude.md is ignored with a CLAUDE.md definition', () => {
  const { group } = shop();
  mkdirSync(join(group.definition, 'backends'));
  writeFileSync(join(group.definition, 'backends', 'claude.md'), 'Claude only\n');
  renderRunDirectory(group);
  expect(existsSync(join(group.runDirectory, 'backends'))).toBe(false);
});

test('a repo with only an AGENTS.md is imported, checked on every render', () => {
  const { group, api } = agentsGroup();
  writeFileSync(join(api, 'AGENTS.md'), 'API rules\n');
  renderRunDirectory(group);
  expect(runDirectoryFile(group, 'CLAUDE.md')).toBe(
    `${MARKDOWN_MARKER}@AGENTS.md\n@${join(api, 'AGENTS.md')}\n`,
  );
  writeFileSync(join(api, 'CLAUDE.md'), 'API rules for Claude\n');
  expect(renderRunDirectory(group).written).toEqual(['CLAUDE.md']);
  expect(runDirectoryFile(group, 'CLAUDE.md')).toBe(`${MARKDOWN_MARKER}@AGENTS.md\n`);
});

test('both AGENTS.md and CLAUDE.md in the definition is an error naming the file to remove', () => {
  const { group } = shop();
  writeFileSync(join(group.definition, 'AGENTS.md'), 'rules');
  expect(() => renderRunDirectory(group)).toThrow(
    /both AGENTS\.md and CLAUDE\.md.*remove CLAUDE\.md/,
  );
  expect(() => definitionInstructions(group)).toThrow(
    expect.objectContaining({ code: 'GROUP_INSTRUCTIONS_CONFLICT' }),
  );
});

test('switching the definition between CLAUDE.md and AGENTS.md re-renders both ways', () => {
  const { group } = shop();
  writeFileSync(join(group.definition, 'CLAUDE.md'), 'Shop rules\n');
  renderRunDirectory(group);
  rmSync(join(group.definition, 'CLAUDE.md'));
  writeFileSync(join(group.definition, 'AGENTS.md'), 'Shop rules\n');
  renderRunDirectory(group);
  expect(runDirectoryFile(group, 'CLAUDE.md')).toBe(`${MARKDOWN_MARKER}@AGENTS.md\n`);
  rmSync(join(group.definition, 'AGENTS.md'));
  writeFileSync(join(group.definition, 'CLAUDE.md'), 'Shop rules\n');
  const result = renderRunDirectory(group);
  expect(result.removed).toEqual(['AGENTS.md']);
  expect(runDirectoryFile(group, 'CLAUDE.md')).toBe(`${MARKDOWN_MARKER}Shop rules\n`);
  expect(existsSync(join(group.runDirectory, 'AGENTS.md'))).toBe(false);
});

test('a hand-written AGENTS.md or CLAUDE.md in the run directory is refused', () => {
  const { group } = agentsGroup();
  writeFileSync(join(group.runDirectory, 'AGENTS.md'), 'hand-written');
  expect(() => renderRunDirectory(group)).toThrow(
    expect.objectContaining({ code: 'RUN_DIRECTORY_FILE_CONFLICT' }),
  );
  rmSync(join(group.runDirectory, 'AGENTS.md'));
  writeFileSync(join(group.runDirectory, 'CLAUDE.md'), 'hand-written');
  expect(() => renderRunDirectory(group)).toThrow(
    expect.objectContaining({ code: 'RUN_DIRECTORY_FILE_CONFLICT' }),
  );
});
