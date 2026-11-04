import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { tempDirectory } from './helpers.ts';

const bin = join(import.meta.dirname, '..', 'dist', 'cli.mjs');

// The test may itself run inside a rucher session, whose variables would pick its group.
function withoutRucher(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('RUCHER_')));
}

test.skipIf(!existsSync(bin))('built binary runs help, groups create, hook and status', () => {
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
  expect(run(['groups', 'create', 'demo', '--repos', api])).toContain('demo created');
  expect(run(['group', 'show'])).toContain(api);
  expect(run(['group', 'path', '-g', 'demo'])).toContain(join('workspaces', 'demo'));
  run(['hook', 'session-start'], JSON.stringify({ session_id: 's1', cwd: join(api, 'src') }));
  const status = run(['status']);
  expect(status).toContain('Waiting on you\n  nothing');
  expect(run(['log'])).toBe('no events yet\n');
  expect(run(['complete', 'zsh'])).toContain('#compdef rucher');
  expect(run(['complete', '--', 'sessions', 'move', 's1', '--to', ''])).toContain('demo');
});
