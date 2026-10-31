import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CarnetError } from "../errors.ts";

export const GROUP_DIR = ".rucher";
export const GROUP_FILE = "group.json";
export const DB_FILE = "carnet.db";

export interface Group {
  root: string;
  name: string;
  repos: string[];
  dbPath: string;
}

interface GroupFile {
  name: string;
  repos?: string[];
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

export function loadGroup(root: string): Group {
  const file = JSON.parse(readFileSync(join(root, GROUP_DIR, GROUP_FILE), "utf8")) as GroupFile;
  return { root, name: file.name, repos: file.repos ?? [], dbPath: join(root, GROUP_DIR, DB_FILE) };
}

export interface LocateOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export function locateGroup({ cwd = process.cwd(), env = process.env }: LocateOptions = {}): Group {
  const root =
    findGroupRoot(cwd) ?? (env.CLAUDE_PROJECT_DIR ? findGroupRoot(env.CLAUDE_PROJECT_DIR) : null);
  if (!root) {
    throw new CarnetError(
      "NO_GROUP",
      `No Rucher group found from ${cwd}: run "rucher init" in your meta directory`,
    );
  }
  return loadGroup(root);
}
