import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import {
  type CarnetError,
  createWorkspace,
  DEFAULT_HOST,
  workspaceHosts,
  hostById,
  loadWorkspace,
} from '../src/index.ts';
import { tempDirectory } from './helpers.ts';

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
