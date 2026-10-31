import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface GroupRef {
  name: string;
  path: string;
}

interface RegistryFile {
  groups: GroupRef[];
}

export function rucherHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.RUCHER_HOME ?? join(homedir(), ".rucher");
}

function registryPath(env?: NodeJS.ProcessEnv): string {
  return join(rucherHome(env), "groups.json");
}

export function readRegistry(env?: NodeJS.ProcessEnv): GroupRef[] {
  const file = registryPath(env);
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<RegistryFile>;
  return parsed.groups ?? [];
}

export function registerGroup(ref: GroupRef, env?: NodeJS.ProcessEnv): GroupRef[] {
  const groups = readRegistry(env).filter((g) => g.path !== ref.path);
  groups.push(ref);
  groups.sort((a, b) => a.name.localeCompare(b.name));
  mkdirSync(rucherHome(env), { recursive: true });
  writeFileSync(
    registryPath(env),
    `${JSON.stringify({ groups } satisfies RegistryFile, null, 2)}\n`,
  );
  return groups;
}
