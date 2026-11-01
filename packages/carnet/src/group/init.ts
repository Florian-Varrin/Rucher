import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { CarnetError } from "../errors.ts";
import { openDatabase } from "../db/open.ts";
import { DB_FILE, GROUP_DIR, GROUP_FILE, type Group, type GroupFile, loadGroup } from "./locate.ts";
import { registerGroup } from "./registry.ts";

export interface InitOptions {
  name?: string;
  repos?: string[];
  env?: NodeJS.ProcessEnv;
}

export function initGroup(dir: string, options: InitOptions = {}): Group {
  const root = resolve(dir);
  const groupDir = join(root, GROUP_DIR);
  if (existsSync(groupDir)) {
    throw new CarnetError("GROUP_EXISTS", `${root} is already a Rucher group`);
  }
  const name = options.name ?? basename(root);
  const file: GroupFile = options.repos ? { name, repos: options.repos } : { name };
  mkdirSync(groupDir, { recursive: true });
  writeFileSync(join(groupDir, GROUP_FILE), `${JSON.stringify(file, null, 2)}\n`);
  openDatabase(join(groupDir, DB_FILE)).close();
  registerGroup({ name, path: root }, options.env);
  return loadGroup(root);
}
