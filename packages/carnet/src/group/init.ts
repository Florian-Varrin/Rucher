import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { CarnetError } from "../errors.ts";
import { openDatabase } from "../db/open.ts";
import { DB_FILE, GROUP_DIR, GROUP_FILE, type Group } from "./locate.ts";
import { registerGroup } from "./registry.ts";

export interface InitOptions {
  name?: string;
  repos?: string[];
  env?: NodeJS.ProcessEnv;
}

export function detectRepos(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .filter((entry) => existsSync(join(root, entry.name, ".git")))
    .map((entry) => entry.name)
    .sort();
}

export function initGroup(dir: string, options: InitOptions = {}): Group {
  const root = resolve(dir);
  const groupDir = join(root, GROUP_DIR);
  if (existsSync(groupDir)) {
    throw new CarnetError("GROUP_EXISTS", `${root} is already a Rucher group`);
  }
  const name = options.name ?? basename(root);
  const repos = options.repos ?? detectRepos(root);
  mkdirSync(groupDir, { recursive: true });
  writeFileSync(join(groupDir, GROUP_FILE), `${JSON.stringify({ name, repos }, null, 2)}\n`);
  const dbPath = join(groupDir, DB_FILE);
  openDatabase(dbPath).close();
  registerGroup({ name, path: root }, options.env);
  return { root, name, repos, dbPath };
}
