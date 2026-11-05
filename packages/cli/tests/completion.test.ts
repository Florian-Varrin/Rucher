import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createGroup, openCarnet } from '@rucher/carnet';
import type { ArgsDef, CommandDef } from 'citty';
import { expect, test } from 'vite-plus/test';
import {
  type CompletionContext,
  completionConfig,
  splitInlineValues,
  suggestDirectories,
  suggestGroups,
  suggestNotes,
  suggestRepoNames,
  suggestRepos,
  suggestSessions,
  uncompletedArguments,
} from '../src/completion.ts';
import { main } from '../src/main.ts';
import { SESSION, tempDirectory } from './helpers.ts';

function collect(suggest: (complete: (value: string, description: string) => void) => void) {
  const values: string[] = [];
  suggest((value) => values.push(value));
  return values;
}

function shopGroup() {
  const env = { RUCHER_HOME: tempDirectory('home-') };
  const api = tempDirectory('shop-api-');
  const meta = createGroup('shop', { env, repos: [api] }).workspace;
  const carnet = openCarnet({ cwd: meta, env });
  carnet.sessions.upsertFromHook({ session_id: SESSION, cwd: meta, source: 'startup' });
  carnet.sessions.name(SESSION, 'shop-auth', 'Login flow');
  carnet.sessions.upsertFromHook({ session_id: 'b7d2e9c4-0000-4000-8000-000000000000', cwd: meta });
  carnet.sessions.upsertFromHook({ session_id: 'c1a0f3e8-0000-4000-8000-000000000000', cwd: meta });
  carnet.sessions.drop('c1a0f3e8-0000-4000-8000-000000000000');
  carnet.close();
  return { env, meta, api };
}

const context = (cwd: string, env: NodeJS.ProcessEnv, typedWords: string[] = ['']) =>
  ({ cwd, env, typedWords }) satisfies CompletionContext;

test('sessions: names first, then short ids, dropped and already typed ones left out', () => {
  const { env, meta } = shopGroup();
  expect(collect((complete) => suggestSessions(context(meta, env), complete))).toEqual([
    'shop-auth',
    'b7d2e9c4',
  ]);
  const merging = context(meta, env, ['sessions', 'merge', 'shop-auth', '']);
  expect(collect((complete) => suggestSessions(merging, complete))).toEqual(['b7d2e9c4']);
});

test('groups, repos and directories', () => {
  const { env, meta, api } = shopGroup();
  expect(collect((complete) => suggestGroups(context(meta, env), complete))).toEqual(['shop']);
  expect(collect((complete) => suggestRepos(context(meta, env), complete))).toEqual([api]);
  mkdirSync(join(meta, 'web', 'src'), { recursive: true });
  expect(collect((complete) => suggestDirectories(context(meta, env, ['w']), complete))).toEqual([
    'web',
  ]);
  expect(collect((complete) => suggestDirectories(context(meta, env, ['web/']), complete))).toEqual(
    ['web/src'],
  );
});

test('outside a group nothing is suggested and nothing throws', () => {
  const env = { RUCHER_HOME: tempDirectory('home-') };
  const outside = tempDirectory('outside-');
  expect(collect((complete) => suggestSessions(context(outside, env), complete))).toEqual([]);
  expect(collect((complete) => suggestRepos(context(outside, env), complete))).toEqual([]);
  expect(collect((complete) => suggestGroups(context(outside, env), complete))).toEqual([]);
});

function twoGroups() {
  const { env, meta, api } = shopGroup();
  const blogRepo = tempDirectory('blog-api-');
  const blog = createGroup('blog', { env, repos: [blogRepo] }).workspace;
  const carnet = openCarnet({ cwd: blog, env });
  const id = 'd4e5f6a7-0000-4000-8000-000000000000';
  carnet.sessions.upsertFromHook({ session_id: id, cwd: blog, source: 'startup' });
  carnet.sessions.name(id, 'blog', 'Same name as its group');
  carnet.notes.add({ kind: 'learning', text: 'Feeds are cached' });
  carnet.close();
  return { env, meta, api, blog, blogRepo };
}

test.each([
  [['resume', '-g', 'blog', ''], ['blog']],
  [['resume', '--group', 'blog', ''], ['blog']],
  [['sessions', 'merge', 'blog', '-g', 'blog', ''], []],
])('-g picks the group of the suggested sessions: %j', (typedWords, expected) => {
  const { env } = twoGroups();
  const outside = tempDirectory('outside-');
  expect(
    collect((complete) => suggestSessions(context(outside, env, typedWords), complete)),
  ).toEqual(expected);
});

test('-g wins over the workspace, and over the group a cursor word hints at', () => {
  const { env, meta, blogRepo } = twoGroups();
  const words = ['group', 'remove', '-g', 'blog', ''];
  expect(collect((complete) => suggestRepos(context(meta, env, words), complete))).toEqual([
    blogRepo,
  ]);
  const cursorOnGroup = ['resume', '-g', 'blog'];
  expect(
    collect((complete) => suggestSessions(context(meta, env, cursorOnGroup), complete)),
  ).toEqual(['shop-auth', 'b7d2e9c4']);
});

test('-g also scopes notes and repo names, and stops at the passthrough', () => {
  const { env, meta } = twoGroups();
  const outside = tempDirectory('outside-');
  const words = ['notes', 'show', '-g', 'blog', ''];
  expect(collect((complete) => suggestNotes(context(outside, env, words), complete))).toEqual([
    '1',
  ]);
  expect(collect((complete) => suggestRepoNames(context(outside, env, words), complete))).toEqual(
    expect.arrayContaining([expect.stringMatching(/^blog-api-/)]),
  );
  const passthrough = ['resume', '--', '-g', 'blog', ''];
  expect(collect((complete) => suggestSessions(context(meta, env, passthrough), complete))).toEqual(
    ['shop-auth', 'b7d2e9c4'],
  );
});

test('an unknown -g suggests nothing and throws nothing', () => {
  const { env, meta } = twoGroups();
  const words = ['resume', '-g', 'nope', ''];
  expect(collect((complete) => suggestSessions(context(meta, env, words), complete))).toEqual([]);
  expect(collect((complete) => suggestRepos(context(meta, env, words), complete))).toEqual([]);
  expect(collect((complete) => suggestNotes(context(meta, env, words), complete))).toEqual([]);
});

test('inline values split, except the word under the cursor', () => {
  expect(splitInlineValues(['resume', '--group=shop', ''])).toEqual([
    'resume',
    '--group',
    'shop',
    '',
  ]);
  expect(splitInlineValues(['resume', '-g=shop', 'x'])).toEqual(['resume', '-g', 'shop', 'x']);
  expect(splitInlineValues(['resume', '--group=sh'])).toEqual(['resume', '--group=sh']);
});

type ConfigNode = {
  subCommands?: Record<string, ConfigNode>;
  args?: Record<string, unknown>;
  options?: Record<string, unknown>;
};

async function argumentPaths(command: CommandDef, path: string[]): Promise<string[]> {
  const resolve = async <T>(value: T | (() => T | Promise<T>)) =>
    typeof value === 'function' ? await (value as () => T | Promise<T>)() : value;
  const args = (await resolve(command.args)) as ArgsDef | undefined;
  const own = Object.entries(args ?? {})
    .filter(([, definition]) => definition.type !== 'boolean')
    .map(([name, definition]) =>
      [...path, definition.type === 'positional' ? name : `--${name}`].join(' '),
    );
  const subCommands = (await resolve(command.subCommands)) ?? {};
  const nested = await Promise.all(
    Object.entries(subCommands)
      .filter(([name]) => !['hook', 'serve', 'complete'].includes(name))
      .map(async ([name, sub]) => argumentPaths(await resolve(sub), [...path, name])),
  );
  return [...own, ...nested.flat()];
}

function handledPaths(node: ConfigNode, path: string[]): string[] {
  return [
    ...Object.keys(node.args ?? {}).map((name) => [...path, name].join(' ')),
    ...Object.keys(node.options ?? {}).map((name) => [...path, `--${name}`].join(' ')),
    ...Object.entries(node.subCommands ?? {}).flatMap(([name, child]) =>
      handledPaths(child, [...path, name]),
    ),
  ];
}

test('every argument of the command tree is completed or explicitly left out', async () => {
  const handled = new Set([...handledPaths(completionConfig, []), ...uncompletedArguments]);
  const missing = (await argumentPaths(main, [])).filter((path) => !handled.has(path));
  expect(missing).toEqual([]);
});
