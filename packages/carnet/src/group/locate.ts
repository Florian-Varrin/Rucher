import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { CarnetError } from "../errors.ts";
import { readRegistry } from "./registry.ts";

export const GROUP_DIR = ".rucher";
export const GROUP_FILE = "group.json";
export const DB_FILE = "carnet.db";

export interface Group {
  root: string;
  name: string;
  repos: string[];
  dbPath: string;
}

export interface GroupFile {
  name: string;
  repos: string[];
}

export function isInside(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel === "" || (!rel.startsWith("..") && !resolve(rel).startsWith(rel));
}

export function repoNameFor(group: Group, path: string | undefined): string | null {
  if (!path) return null;
  const repo = group.repos.find((r) => isInside(r, resolve(path)));
  return repo ? basename(repo) : null;
}

export function findGroupRoot(from: string): string | null {
  let dir = resolve(from);
  for (;;) {
    const marker = join(dir, GROUP_DIR);
    if (existsSync(marker) && statSync(marker).isDirectory()) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function isGroupRoot(dir: string): boolean {
  return existsSync(join(dir, GROUP_DIR, GROUP_FILE));
}

export function loadGroup(root: string): Group {
  const file = JSON.parse(readFileSync(join(root, GROUP_DIR, GROUP_FILE), "utf8")) as GroupFile;
  return {
    root,
    name: file.name,
    repos: (file.repos ?? []).map((r) => resolve(root, r)),
    dbPath: join(root, GROUP_DIR, DB_FILE),
  };
}

export interface LocateOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

function groupByRepo(path: string, env?: NodeJS.ProcessEnv): Group | null {
  for (const ref of readRegistry(env)) {
    if (!isGroupRoot(ref.path)) continue;
    const group = loadGroup(ref.path);
    if (group.repos.some((r) => isInside(r, path))) return group;
  }
  return null;
}

export function locateGroup({ cwd = process.cwd(), env = process.env }: LocateOptions = {}): Group {
  const candidates = [
    resolve(cwd),
    ...(env.CLAUDE_PROJECT_DIR ? [resolve(env.CLAUDE_PROJECT_DIR)] : []),
  ];
  for (const dir of candidates) {
    const root = findGroupRoot(dir);
    if (root) return loadGroup(root);
  }
  for (const dir of candidates) {
    const group = groupByRepo(dir, env);
    if (group) return group;
  }
  throw new CarnetError(
    "NO_GROUP",
    `No Rucher group for ${cwd}: run "rucher init" in a meta directory, or "rucher group add <this repo>" there`,
  );
}
