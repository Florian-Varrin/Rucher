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

function writeRegistry(groups: GroupRef[], env?: NodeJS.ProcessEnv): GroupRef[] {
  groups.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  mkdirSync(rucherHome(env), { recursive: true });
  writeFileSync(
    registryPath(env),
    `${JSON.stringify({ groups } satisfies RegistryFile, null, 2)}\n`,
  );
  return groups;
}

export function registerGroup(ref: GroupRef, env?: NodeJS.ProcessEnv): GroupRef[] {
  return writeRegistry([...readRegistry(env).filter((g) => g.path !== ref.path), ref], env);
}

export function unregisterGroups(paths: string[], env?: NodeJS.ProcessEnv): GroupRef[] {
  return writeRegistry(
    readRegistry(env).filter((g) => !paths.includes(g.path)),
    env,
  );
}
