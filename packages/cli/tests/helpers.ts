import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Carnet, type Workspace, MEMORY_DB, openDatabase } from '@rucher/carnet';
import type { Io } from '../src/io.ts';

export const SESSION = '0360889d-99c7-4c8f-8447-50ce30696e5a';

export function tempDirectory(prefix = 'rucher-cli-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// Where Claude Code would file the session's transcript, under the test's CLAUDE_CONFIG_DIR.
export function writeConversation(env: NodeJS.ProcessEnv, cwd: string, id: string): void {
  const project = join(env.CLAUDE_CONFIG_DIR ?? '', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, `${id}.jsonl`), '{}\n');
}

export function makeClock(start = '2026-10-31T15:41:00.000Z'): () => Date {
  let time = Date.parse(start);
  return () => new Date((time += 1000));
}

export function workspaceAt(root: string, name: string, repos: readonly string[]): Workspace {
  return {
    name,
    definition: join(root, 'definition'),
    runDirectory: root,
    repos: repos.map((path) => ({ path, name: basename(path) })),
    backends: {},
  };
}

export function makeCarnet(): { carnet: Carnet; root: string } {
  const root = tempDirectory();
  mkdirSync(join(root, 'api'));
  const carnet = new Carnet(
    openDatabase(MEMORY_DB),
    workspaceAt(root, 'test-workspace', [join(root, 'api')]),
    {
      now: makeClock(),
    },
  );
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
    // Never the real home: every Rucher location derives from RUCHER_HOME, Claude Code's from CLAUDE_CONFIG_DIR.
    env: { RUCHER_HOME: tempDirectory('home-'), CLAUDE_CONFIG_DIR: tempDirectory('claude-') },
    color: false,
    columns: 80,
    ...overrides,
  };
  return io;
}
