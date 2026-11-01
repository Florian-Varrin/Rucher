import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Carnet, MEMORY_DB, openDatabase } from '@rucher/carnet';
import type { Io } from '../src/io.ts';

export const SESSION = '0360889d-99c7-4c8f-8447-50ce30696e5a';

export function tempDirectory(prefix = 'rucher-cli-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function makeClock(start = '2026-10-31T15:41:00.000Z'): () => Date {
  let time = Date.parse(start);
  return () => new Date((time += 1000));
}

export function makeCarnet(): { carnet: Carnet; root: string } {
  const root = tempDirectory();
  mkdirSync(join(root, 'api'));
  const group = {
    root,
    name: 'test-group',
    repos: [join(root, 'api')],
    hosts: ['claude-code'],
    dbPath: MEMORY_DB,
  };
  const carnet = new Carnet(group, openDatabase(MEMORY_DB), { now: makeClock() });
  carnet.sessions.upsertFromHook({
    session_id: SESSION,
    cwd: join(root, 'api'),
    source: 'startup',
  });
  return { carnet, root };
}

export interface FakeIo extends Io {
  output: string[];
  errors: string[];
}

export function makeIo(overrides: Partial<Io> = {}): FakeIo {
  const io: FakeIo = {
    output: [],
    errors: [],
    stdout: (text) => {
      io.output.push(text);
    },
    stderr: (text) => {
      io.errors.push(text);
    },
    cwd: tempDirectory('cwd-'),
    env: {},
    color: false,
    columns: 80,
    ...overrides,
  };
  return io;
}
