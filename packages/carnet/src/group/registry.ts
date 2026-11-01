import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface GroupReference {
  name: string;
  path: string;
}

interface RegistryFile {
  groups: GroupReference[];
}

export function rucherHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.RUCHER_HOME ?? join(homedir(), '.rucher');
}

function registryPath(env?: NodeJS.ProcessEnv): string {
  return join(rucherHome(env), 'groups.json');
}

export function readRegistry(env?: NodeJS.ProcessEnv): GroupReference[] {
  const file = registryPath(env);
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<RegistryFile>;
  return parsed.groups ?? [];
}

function writeRegistry(groups: GroupReference[], env?: NodeJS.ProcessEnv): GroupReference[] {
  groups.sort(
    (left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path),
  );
  mkdirSync(rucherHome(env), { recursive: true });
  writeFileSync(
    registryPath(env),
    `${JSON.stringify({ groups } satisfies RegistryFile, null, 2)}\n`,
  );
  return groups;
}

export function registerGroup(
  reference: GroupReference,
  env?: NodeJS.ProcessEnv,
): GroupReference[] {
  return writeRegistry(
    [...readRegistry(env).filter((group) => group.path !== reference.path), reference],
    env,
  );
}

export function unregisterGroups(paths: string[], env?: NodeJS.ProcessEnv): GroupReference[] {
  return writeRegistry(
    readRegistry(env).filter((group) => !paths.includes(group.path)),
    env,
  );
}
