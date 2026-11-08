import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import {
  type CarnetError,
  claudeCode,
  createWorkspace,
  DEFAULT_HOST,
  workspaceHosts,
  hostById,
  loadWorkspace,
} from '../src/index.ts';
import { tempDirectory } from './helpers.ts';
import type { Session } from '../src/sessions.ts';

test('a workspace renders for its backends, claude-code when workspace.json has none', () => {
  const env = { RUCHER_HOME: tempDirectory('home-') };
  const workspace = createWorkspace('shop', { env });
  expect(workspaceHosts(workspace)).toEqual([DEFAULT_HOST]);
  const file = join(workspace.definition, 'workspace.json');
  writeFileSync(file, JSON.stringify({ name: 'shop', backends: { 'claude-code': {} } }));
  expect(workspaceHosts(loadWorkspace('shop', env))).toEqual(['claude-code']);
  expect(JSON.parse(readFileSync(file, 'utf8')).repos).toBeUndefined();
});

test('an unknown host is refused', () => {
  let code: string | undefined;
  try {
    hostById('nope');
  } catch (error) {
    code = (error as CarnetError).code;
  }
  expect(code).toBe('UNKNOWN_HOST');
  expect(hostById('claude-code').resumeCommand({ id: 'abc' } as never)).toEqual({
    command: 'claude',
    args: ['--resume', 'abc'],
  });
});

test('claude-code finds a conversation in any project directory, none before the first message', () => {
  const env = { CLAUDE_CONFIG_DIR: tempDirectory('claude-') };
  const session = { id: 'abc-123', cwd: '/work/shop' } as Session;
  expect(claudeCode.hasConversation(session, env)).toBe(false);
  const other = join(env.CLAUDE_CONFIG_DIR, 'projects', '-elsewhere');
  mkdirSync(other, { recursive: true });
  writeFileSync(join(other, 'abc-123-other.jsonl'), '{}\n');
  expect(claudeCode.hasConversation(session, env)).toBe(false);
  writeFileSync(join(other, 'abc-123.jsonl'), '{}\n');
  expect(claudeCode.hasConversation(session, env)).toBe(true);
});
