import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { type CarnetError, DEFAULT_HOST, hostById, initGroup, loadGroup } from '../src/index.ts';
import { tempDirectory } from './helpers.ts';

test('a group records its hosts, claude-code when group.json has none', () => {
  const env = { RUCHER_HOME: tempDirectory('home-') };
  const meta = tempDirectory('meta-');
  expect(initGroup(meta, { env }).hosts).toEqual([DEFAULT_HOST]);
  const file = join(meta, '.rucher', 'group.json');
  expect(JSON.parse(readFileSync(file, 'utf8')).hosts).toEqual(['claude-code']);
  writeFileSync(file, JSON.stringify({ name: 'shop', repos: [] }));
  expect(loadGroup(meta).hosts).toEqual(['claude-code']);
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
