import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { resumeTarget } from '../src/commands/resume.ts';
import { sessionsMerge, sessionsOnce } from '../src/commands/sessions.ts';
import { CliError } from '../src/session.ts';
import { makeCarnet, makeIo, SESSION } from './helpers.ts';

test('sessions lists active sessions, --all adds temp and archived ones', () => {
  const { carnet } = makeCarnet();
  const io = makeIo();
  sessionsOnce(carnet, io);
  expect(io.output.join('')).toBe(
    'no active session yet (temp and archived ones are hidden, use --all)\n',
  );

  carnet.sessions.name(SESSION, 'shop-auth', 'Login flow');
  carnet.agents.start(SESSION, { name: 'banner', task: 't' });
  carnet.sessions.ensure('other');
  carnet.sessions.name('other', 'shop-cart');
  carnet.sessions.drop('other');
  carnet.sessions.ensure('temp-session');
  const now = new Date();
  const named = makeIo();
  sessionsOnce(carnet, named, { now });
  expect(named.output.join('')).toMatch(
    /^shop-auth {2}active {2}idle {2}api {2}\S+ {2}1 agent {2}Login flow\n$/,
  );

  const all = makeIo();
  sessionsOnce(carnet, all, { all: true, now });
  const names = all.output
    .join('')
    .trimEnd()
    .split('\n')
    .map((line) => line.split(' ')[0] ?? '');
  expect(names.sort()).toEqual(['shop-auth', 'shop-cart', 'temp-ses']);
});

test('resume targets claude --resume with the session id from its original cwd', () => {
  const { carnet, root } = makeCarnet();
  carnet.sessions.name(SESSION, 'shop-auth');
  const io = makeIo();
  expect(resumeTarget(carnet, 'shop-auth', io)).toEqual({
    command: 'claude',
    args: ['--resume', SESSION],
    cwd: join(root, 'api'),
  });
  expect(resumeTarget(carnet, SESSION, io).args).toEqual(['--resume', SESSION]);
  expect(io.errors).toEqual([]);
});

test('resume falls back to the current directory, warns on archived, refuses unknown', () => {
  const { carnet, root } = makeCarnet();
  const gone = join(root, 'gone');
  mkdirSync(gone);
  carnet.sessions.upsertFromHook({ session_id: 's2', cwd: join(gone, 'missing') });
  carnet.sessions.name('s2', 'shop-old');
  carnet.sessions.drop('s2');
  const io = makeIo();
  expect(resumeTarget(carnet, 'shop-old', io).cwd).toBe(io.cwd);
  expect(io.errors.join('')).toBe('warning: session shop-old is archived\n');
  expect(() => resumeTarget(carnet, 'nope', io)).toThrowError(CliError);
});

test('sessions merge moves everything into the target and reports it', () => {
  const { carnet } = makeCarnet();
  carnet.sessions.ensure('provisional');
  carnet.agents.start('provisional', { name: 'lost', task: 'task' });
  carnet.sessions.name(SESSION, 'shop-auth');
  const io = makeIo();
  sessionsMerge(carnet, 'provisional', 'shop-auth', io);
  expect(io.output.join('')).toContain('merged provisio into shop-auth');
  expect(io.output.join('')).toContain('agents moved: lost');
  expect(carnet.agents.get(SESSION, 'lost')?.status).toBe('running');
  expect(() => sessionsMerge(carnet, 'missing', 'shop-auth', makeIo())).toThrowError(CliError);
});

test('sessions merge and resume accept the short ids shown by rucher sessions', () => {
  const { carnet } = makeCarnet();
  const split = '8c2fce7d-d378-4abf-a791-cbe8a499d65c';
  carnet.sessions.ensure(split);
  carnet.agents.start(split, { name: 'lost', task: 'task' });
  sessionsMerge(carnet, '8c2fce7d', SESSION.slice(0, 8), makeIo());
  expect(carnet.agents.get(SESSION, 'lost')?.status).toBe('running');
  expect(resumeTarget(carnet, SESSION.slice(0, 8), makeIo()).args).toEqual(['--resume', SESSION]);
  expect(() => resumeTarget(carnet, '036', makeIo())).toThrowError(/at least 4 characters/);
});
