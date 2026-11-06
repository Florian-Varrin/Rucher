import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { tempDirectory } from './helpers.ts';

const bin = join(import.meta.dirname, '..', 'dist', 'cli.mjs');

// The test may itself run inside a rucher session, whose variables would pick its workspace.
function withoutRucher(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('RUCHER_')));
}

test.skipIf(!existsSync(bin))('built binary runs help, ws create, hook and status', () => {
  const api = tempDirectory('repo-api-');
  mkdirSync(join(api, 'src'), { recursive: true });
  const env = {
    ...withoutRucher(process.env),
    RUCHER_HOME: tempDirectory('home-'),
    NO_COLOR: '1',
    CLAUDE_PID: '77',
  };
  const run = (args: string[], input?: string) =>
    execFileSync('node', [bin, ...args], { cwd: api, env, input, encoding: 'utf8' });

  expect(run(['--help'])).toContain('status');
  expect(run(['ws', 'create', 'demo', '--repos', api])).toContain('demo created');
  expect(run(['ws', 'show'])).toContain(api);
  expect(run(['ws', 'path', '--ws', 'demo'])).toContain(join('workspaces', 'demo'));
  expect(run(['ws', 'path', '--run', '--ws', 'demo'])).toContain(join('workspaces', 'demo'));
  expect(run(['ws', 'path', '--def', '--ws', 'demo'])).toContain(
    join('config', 'workspaces', 'demo'),
  );
  run(['hook', 'session-start'], JSON.stringify({ session_id: 's1', cwd: join(api, 'src') }));
  const status = run(['status']);
  expect(status).toContain('Waiting on you\n  nothing');
  expect(run(['log'])).toBe('no events yet\n');
  expect(run(['complete', 'zsh'])).toContain('#compdef rucher');
  expect(run(['complete', '--', 'sessions', 'move', 's1', '--to', ''])).toContain('demo');
  expect(run(['complete', '--', 'resume', '--ws', 'demo', ''])).toContain('s1');
  expect(run(['complete', '--', 'resume', '--ws=demo', ''])).toContain('s1');
});

test.skipIf(!existsSync(bin))(
  'sessions list outside a workspace exits 0 with a stderr hint',
  () => {
    const result = spawnSync('node', [bin, 'sessions', 'list'], {
      cwd: tempDirectory('outside-'),
      env: { ...withoutRucher(process.env), RUCHER_HOME: tempDirectory('home-'), NO_COLOR: '1' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('no workspace here: pass --ws\n');
  },
);

test.skipIf(!existsSync(bin))('--ws before a subcommand reaches it', () => {
  const env = {
    ...withoutRucher(process.env),
    RUCHER_HOME: tempDirectory('home-'),
    NO_COLOR: '1',
    CLAUDE_PID: '77',
  };
  const run = (args: string[], cwd: string, input?: string) =>
    spawnSync('node', [bin, ...args], { cwd, env, input, encoding: 'utf8' });
  const outside = tempDirectory('outside-');
  run(['ws', 'create', 'aa'], outside);
  run(['ws', 'create', 'bb'], outside);
  const inside = (name: string) => run(['ws', 'path', '--ws', name], outside).stdout.trimEnd();
  const started = (name: string, id: string) => {
    const payload = JSON.stringify({ session_id: id, cwd: inside(name) });
    run(['hook', 'session-start'], inside(name), payload);
    run(['hook', 'session-end'], inside(name), payload);
  };
  started('aa', 'in-aa');
  started('bb', 'in-bb');
  run(['sessions', 'promote', 'in-aa', 'kept', '--ws', 'aa'], outside);
  run(['sessions', 'promote', 'in-bb', 'mine', '--ws', 'bb'], outside);
  run(['notes', 'add', 'learning', 'Only in aa', '--ws', 'aa'], outside);

  const here = inside('bb');
  expect(run(['sessions', '--ws', 'aa', 'list'], here).stdout).toContain('kept');
  expect(run(['sessions', '--ws=aa', 'list'], here).stdout).not.toContain('mine');
  expect(run(['sessions', '--ws', 'aa', 'list', '--ws', 'bb'], here).stdout).toContain('mine');
  expect(run(['notes', '--ws', 'aa', 'list'], here).stdout).toContain('Only in aa');
  expect(run(['ws', '--ws', 'aa', 'show'], here).stdout).toContain(inside('aa'));

  const renamed = run(['sessions', '--ws', 'aa', 'rename', 'kept', 'moved'], here);
  expect(renamed.status).toBe(0);
  expect(run(['sessions', 'list', '--ws', 'aa'], here).stdout).toContain('moved');
  expect(run(['sessions', 'list', '--ws', 'bb'], here).stdout).toContain('mine');

  for (const command of ['sessions', 'notes', 'ws']) {
    const subcommand = command === 'ws' ? 'show' : 'list';
    const unknown = run([command, '--ws', 'nope', subcommand], here);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('No workspace named nope');
  }
});

test.skipIf(!existsSync(bin))('the old group option and commands fail', () => {
  const env = { ...withoutRucher(process.env), RUCHER_HOME: tempDirectory('home-'), NO_COLOR: '1' };
  const run = (...args: string[]) =>
    spawnSync('node', [bin, ...args], { cwd: tempDirectory('outside-'), env, encoding: 'utf8' });
  for (const args of [
    ['status', '-g', 'a'],
    ['sessions', 'list', '--group=a'],
    ['groups'],
    ['group'],
  ]) {
    expect(run(...args).status).not.toBe(0);
  }
  expect(run('complete', '--', 'resume', '-g', 'a', '').status).toBe(0);
});
