import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import {
  type CarnetError,
  createGroup,
  DEFAULT_HOST,
  groupHosts,
  hostById,
  loadGroup,
} from '../src/index.ts';
import { tempDirectory } from './helpers.ts';

test('a group renders for its backends, claude-code when group.json has none', () => {
  const env = { RUCHER_HOME: tempDirectory('home-') };
  const group = createGroup('shop', { env });
  expect(groupHosts(group)).toEqual([DEFAULT_HOST]);
  const file = join(group.definition, 'group.json');
  writeFileSync(file, JSON.stringify({ name: 'shop', backends: { 'claude-code': {} } }));
  expect(groupHosts(loadGroup('shop', env))).toEqual(['claude-code']);
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
