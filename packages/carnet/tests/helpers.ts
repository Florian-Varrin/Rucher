import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Carnet, type Workspace, MEMORY_DB, openDatabase } from '../src/index.ts';

export function tempDirectory(prefix = 'carnet-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function makeClock(start = '2026-10-31T15:41:00.000Z'): () => Date {
  let time = Date.parse(start);
  return () => new Date((time += 1000));
}

export function testHome(): NodeJS.ProcessEnv {
  return { RUCHER_HOME: tempDirectory('rucher-home-') };
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

export function testWorkspace(root: string, name = 'test-workspace'): Workspace {
  return workspaceAt(root, name, [join(root, 'api')]);
}

export function makeCarnet(): { carnet: Carnet; root: string } {
  const root = tempDirectory();
  mkdirSync(join(root, 'api'));
  return {
    carnet: new Carnet(openDatabase(MEMORY_DB), testWorkspace(root), { now: makeClock() }),
    root,
  };
}

export const SESSION = '0360889d-99c7-4c8f-8447-50ce30696e5a';

export function withSession(): { carnet: Carnet; root: string } {
  const made = makeCarnet();
  made.carnet.sessions.upsertFromHook({ session_id: SESSION, cwd: made.root, source: 'startup' });
  return made;
}
