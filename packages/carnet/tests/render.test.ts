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
import {
  createWorkspace,
  type Workspace,
  loadWorkspace,
  definitionInstructions,
} from '../src/workspace/workspace.ts';
import { renderRunDirectory } from '../src/render.ts';
import { GENERATED_MARKER, MARKDOWN_MARKER, mergeSettings } from '../src/run-directory-files.ts';
import { tempDirectory, testHome } from './helpers.ts';

function shop(): { workspace: Workspace; env: NodeJS.ProcessEnv; api: string } {
  const env = testHome();
  const api = tempDirectory('shop-api-');
  return { workspace: createWorkspace('shop', { env, repos: [api] }), env, api };
}

const settingsPath = (workspace: Workspace) =>
  join(workspace.runDirectory, '.claude', 'settings.json');
const settings = (workspace: Workspace) =>
  JSON.parse(readFileSync(settingsPath(workspace), 'utf8'));

test('render copies the instructions with the marker and generates the settings', () => {
  const { workspace, api } = shop();
  writeFileSync(join(workspace.definition, 'CLAUDE.md'), 'Shop rules\n@glossary.md\n');
  writeFileSync(join(workspace.definition, 'glossary.md'), 'Cart: a basket\n');
  writeFileSync(join(workspace.definition, 'prompt.md'), 'appended, not copied');
  const result = renderRunDirectory(workspace);
  expect(result).toEqual({
    runDirectory: workspace.runDirectory,
    written: ['CLAUDE.md', 'glossary.md', join('.claude', 'settings.json')],
    removed: [],
  });
  const instructions = join(workspace.runDirectory, 'CLAUDE.md');
  expect(lstatSync(instructions).isFile()).toBe(true);
  expect(readFileSync(instructions, 'utf8')).toBe(`${MARKDOWN_MARKER}Shop rules\n@glossary.md\n`);
  expect(readFileSync(join(workspace.runDirectory, 'glossary.md'), 'utf8')).toBe(
    `${MARKDOWN_MARKER}Cart: a basket\n`,
  );
  expect(existsSync(join(workspace.runDirectory, 'prompt.md'))).toBe(false);
  expect(existsSync(join(workspace.runDirectory, 'reports'))).toBe(true);
  expect(settings(workspace)).toEqual({
    '//': GENERATED_MARKER,
    permissions: {
      additionalDirectories: [api],
      deny: ['Edit(/CLAUDE.md)', 'Edit(/glossary.md)'],
    },
  });
});

test('a second render writes nothing and leaves other run directory files alone', () => {
  const { workspace } = shop();
  renderRunDirectory(workspace);
  const mine = join(workspace.runDirectory, '.claude', 'settings.local.json');
  writeFileSync(mine, '{"mine":true}');
  writeFileSync(join(workspace.runDirectory, 'reports', 'cart.md'), 'report');
  writeFileSync(join(workspace.runDirectory, 'notes.md'), 'hand-written');
  const before = statSync(settingsPath(workspace)).mtimeMs;
  expect(renderRunDirectory(workspace)).toEqual({
    runDirectory: workspace.runDirectory,
    written: [],
    removed: [],
  });
  expect(statSync(settingsPath(workspace)).mtimeMs).toBe(before);
  expect(readFileSync(mine, 'utf8')).toBe('{"mine":true}');
  expect(readFileSync(join(workspace.runDirectory, 'reports', 'cart.md'), 'utf8')).toBe('report');
  expect(readFileSync(join(workspace.runDirectory, 'notes.md'), 'utf8')).toBe('hand-written');
});

test('a definition change rewrites its copy, and a removed definition file loses its copy', () => {
  const { workspace } = shop();
  writeFileSync(join(workspace.definition, 'glossary.md'), 'v1');
  renderRunDirectory(workspace);
  writeFileSync(join(workspace.definition, 'glossary.md'), 'v2');
  expect(renderRunDirectory(workspace).written).toEqual(['glossary.md']);
  expect(readFileSync(join(workspace.runDirectory, 'glossary.md'), 'utf8')).toBe(
    `${MARKDOWN_MARKER}v2`,
  );
  rmSync(join(workspace.definition, 'glossary.md'));
  const result = renderRunDirectory(workspace);
  expect(result.removed).toEqual(['glossary.md']);
  expect(result.written).toEqual([join('.claude', 'settings.json')]);
  expect(existsSync(join(workspace.runDirectory, 'glossary.md'))).toBe(false);
  expect(settings(workspace).permissions.deny).toEqual(['Edit(/CLAUDE.md)']);
});

test('backend settings merge over the generated ones', () => {
  const { workspace, env, api } = shop();
  const file = join(workspace.definition, 'workspace.json');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.backends = {
    'claude-code': {
      settings: {
        permissions: { allow: ['Bash(pnpm test:*)'], additionalDirectories: ['/srv/shared'] },
      },
    },
  };
  writeFileSync(file, JSON.stringify(data));
  renderRunDirectory(loadWorkspace('shop', env));
  expect(settings(workspace).permissions).toEqual({
    additionalDirectories: [api, '/srv/shared'],
    deny: ['Edit(/CLAUDE.md)'],
    allow: ['Bash(pnpm test:*)'],
  });
});

test('render replaces a link left by a previous render and its own files, never hand-written ones', () => {
  const { workspace } = shop();
  mkdirSync(workspace.runDirectory, { recursive: true });
  const instructions = join(workspace.runDirectory, 'CLAUDE.md');
  symlinkSync(join(workspace.definition, 'CLAUDE.md'), instructions);
  renderRunDirectory(workspace);
  expect(lstatSync(instructions).isFile()).toBe(true);

  writeFileSync(settingsPath(workspace), '{"permissions":{}}');
  expect(() => renderRunDirectory(workspace)).toThrowError(/not written by rucher/);
  writeFileSync(settingsPath(workspace), `{"//":"${GENERATED_MARKER}"}`);
  renderRunDirectory(workspace);
  expect(lstatSync(settingsPath(workspace)).isFile()).toBe(true);

  rmSync(instructions);
  writeFileSync(instructions, 'hand-written');
  expect(() => renderRunDirectory(workspace)).toThrowError(/not written by rucher/);
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

function agentsWorkspace(): { workspace: Workspace; env: NodeJS.ProcessEnv; api: string } {
  const made = shop();
  rmSync(join(made.workspace.definition, 'CLAUDE.md'));
  writeFileSync(join(made.workspace.definition, 'AGENTS.md'), 'Shop rules\n@glossary.md\n');
  writeFileSync(join(made.workspace.definition, 'glossary.md'), 'Cart: a basket\n');
  return made;
}

const runDirectoryFile = (workspace: Workspace, name: string) =>
  readFileSync(join(workspace.runDirectory, name), 'utf8');

test('an AGENTS.md definition renders a copy and a generated CLAUDE.md importing it', () => {
  const { workspace } = agentsWorkspace();
  expect(renderRunDirectory(workspace).written).toEqual([
    'AGENTS.md',
    'CLAUDE.md',
    'glossary.md',
    join('.claude', 'settings.json'),
  ]);
  expect(runDirectoryFile(workspace, 'AGENTS.md')).toBe(
    `${MARKDOWN_MARKER}Shop rules\n@glossary.md\n`,
  );
  expect(runDirectoryFile(workspace, 'CLAUDE.md')).toBe(`${MARKDOWN_MARKER}@AGENTS.md\n`);
  expect(settings(workspace).permissions.deny).toEqual([
    'Edit(/AGENTS.md)',
    'Edit(/CLAUDE.md)',
    'Edit(/glossary.md)',
  ]);
  expect(renderRunDirectory(workspace).written).toEqual([]);
});

test('backends/claude.md is copied, imported and denied, then removed with its definition', () => {
  const { workspace } = agentsWorkspace();
  mkdirSync(join(workspace.definition, 'backends'));
  writeFileSync(join(workspace.definition, 'backends', 'claude.md'), 'Claude only\n');
  renderRunDirectory(workspace);
  expect(runDirectoryFile(workspace, 'backends/claude.md')).toBe(`${MARKDOWN_MARKER}Claude only\n`);
  expect(runDirectoryFile(workspace, 'CLAUDE.md')).toBe(
    `${MARKDOWN_MARKER}@AGENTS.md\n@backends/claude.md\n`,
  );
  expect(settings(workspace).permissions.deny).toContain('Edit(/backends/claude.md)');
  rmSync(join(workspace.definition, 'backends', 'claude.md'));
  const result = renderRunDirectory(workspace);
  expect(result.removed).toEqual([join('backends', 'claude.md')]);
  expect(existsSync(join(workspace.runDirectory, 'backends'))).toBe(false);
  expect(runDirectoryFile(workspace, 'CLAUDE.md')).toBe(`${MARKDOWN_MARKER}@AGENTS.md\n`);
});

test('a hand-written file in the run directory backends folder stays', () => {
  const { workspace } = agentsWorkspace();
  mkdirSync(join(workspace.runDirectory, 'backends'), { recursive: true });
  writeFileSync(join(workspace.runDirectory, 'backends', 'mine.md'), 'hand-written');
  expect(renderRunDirectory(workspace).removed).toEqual([]);
  expect(existsSync(join(workspace.runDirectory, 'backends', 'mine.md'))).toBe(true);
});

test('backends/claude.md is ignored with a CLAUDE.md definition', () => {
  const { workspace } = shop();
  mkdirSync(join(workspace.definition, 'backends'));
  writeFileSync(join(workspace.definition, 'backends', 'claude.md'), 'Claude only\n');
  renderRunDirectory(workspace);
  expect(existsSync(join(workspace.runDirectory, 'backends'))).toBe(false);
});

test('a repo with only an AGENTS.md is imported, checked on every render', () => {
  const { workspace, api } = agentsWorkspace();
  writeFileSync(join(api, 'AGENTS.md'), 'API rules\n');
  renderRunDirectory(workspace);
  expect(runDirectoryFile(workspace, 'CLAUDE.md')).toBe(
    `${MARKDOWN_MARKER}@AGENTS.md\n@${join(api, 'AGENTS.md')}\n`,
  );
  writeFileSync(join(api, 'CLAUDE.md'), 'API rules for Claude\n');
  expect(renderRunDirectory(workspace).written).toEqual(['CLAUDE.md']);
  expect(runDirectoryFile(workspace, 'CLAUDE.md')).toBe(`${MARKDOWN_MARKER}@AGENTS.md\n`);
});

test('both AGENTS.md and CLAUDE.md in the definition is an error naming the file to remove', () => {
  const { workspace } = shop();
  writeFileSync(join(workspace.definition, 'AGENTS.md'), 'rules');
  expect(() => renderRunDirectory(workspace)).toThrow(
    /both AGENTS\.md and CLAUDE\.md.*remove CLAUDE\.md/,
  );
  expect(() => definitionInstructions(workspace)).toThrow(
    expect.objectContaining({ code: 'WORKSPACE_INSTRUCTIONS_CONFLICT' }),
  );
});

test('switching the definition between CLAUDE.md and AGENTS.md re-renders both ways', () => {
  const { workspace } = shop();
  writeFileSync(join(workspace.definition, 'CLAUDE.md'), 'Shop rules\n');
  renderRunDirectory(workspace);
  rmSync(join(workspace.definition, 'CLAUDE.md'));
  writeFileSync(join(workspace.definition, 'AGENTS.md'), 'Shop rules\n');
  renderRunDirectory(workspace);
  expect(runDirectoryFile(workspace, 'CLAUDE.md')).toBe(`${MARKDOWN_MARKER}@AGENTS.md\n`);
  rmSync(join(workspace.definition, 'AGENTS.md'));
  writeFileSync(join(workspace.definition, 'CLAUDE.md'), 'Shop rules\n');
  const result = renderRunDirectory(workspace);
  expect(result.removed).toEqual(['AGENTS.md']);
  expect(runDirectoryFile(workspace, 'CLAUDE.md')).toBe(`${MARKDOWN_MARKER}Shop rules\n`);
  expect(existsSync(join(workspace.runDirectory, 'AGENTS.md'))).toBe(false);
});

test('a hand-written AGENTS.md or CLAUDE.md in the run directory is refused', () => {
  const { workspace } = agentsWorkspace();
  writeFileSync(join(workspace.runDirectory, 'AGENTS.md'), 'hand-written');
  expect(() => renderRunDirectory(workspace)).toThrow(
    expect.objectContaining({ code: 'RUN_DIRECTORY_FILE_CONFLICT' }),
  );
  rmSync(join(workspace.runDirectory, 'AGENTS.md'));
  writeFileSync(join(workspace.runDirectory, 'CLAUDE.md'), 'hand-written');
  expect(() => renderRunDirectory(workspace)).toThrow(
    expect.objectContaining({ code: 'RUN_DIRECTORY_FILE_CONFLICT' }),
  );
});
