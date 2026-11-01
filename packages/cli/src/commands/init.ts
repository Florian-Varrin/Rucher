import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CarnetError, type Group, initGroup } from "@rucher/carnet";
import { paint } from "../color.ts";
import type { Io } from "../io.ts";
import { groupClaudeMd, groupSettings, replaceReposBlock } from "../templates.ts";

export interface InitOptions {
  dir?: string;
  name?: string;
  repos?: string[];
}

interface Settings {
  permissions?: { additionalDirectories?: string[] } & Record<string, unknown>;
  [key: string]: unknown;
}

export function syncSettings(group: Group): "written" | "updated" | "unchanged" {
  const path = join(group.root, ".claude", "settings.json");
  if (!existsSync(path)) {
    if (group.repos.length === 0) return "unchanged";
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, groupSettings(group));
    return "written";
  }
  const settings = JSON.parse(readFileSync(path, "utf8")) as Settings;
  const current = settings.permissions?.additionalDirectories ?? [];
  const missing = group.repos.filter((r) => !current.includes(r));
  if (missing.length === 0) return "unchanged";
  settings.permissions = {
    ...settings.permissions,
    additionalDirectories: [...current, ...missing],
  };
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  return "updated";
}

export function syncClaudeMd(group: Group): "written" | "updated" | "unchanged" | "no-markers" {
  const path = join(group.root, "CLAUDE.md");
  if (!existsSync(path)) {
    writeFileSync(path, groupClaudeMd(group));
    return "written";
  }
  const content = readFileSync(path, "utf8");
  const next = replaceReposBlock(content, group);
  if (next === null) return "no-markers";
  if (next === content) return "unchanged";
  writeFileSync(path, next);
  return "updated";
}

export function init(options: InitOptions, io: Io): number {
  const p = paint(io);
  const root = resolve(io.cwd, options.dir ?? ".");
  let group: Group;
  try {
    group = initGroup(root, {
      name: options.name,
      repos: options.repos?.map((r) => resolve(io.cwd, r)),
      env: io.env,
    });
  } catch (error) {
    if (error instanceof CarnetError) {
      io.stderr(`error: ${error.message}\n`);
      return 1;
    }
    throw error;
  }

  const lines = [
    `${p.bold(group.name)} initialised in ${group.root}`,
    `  repos: ${group.repos.length ? group.repos.join(", ") : "none yet, add them with `rucher group add <path>`"}`,
    `  database: ${group.dbPath}`,
  ];
  const claudeMd = syncClaudeMd(group);
  lines.push(
    claudeMd === "written"
      ? "  wrote CLAUDE.md (group instructions template)"
      : `  kept existing CLAUDE.md ${p.dim("(add the rucher:repos markers to keep its repo list in sync, and a line: multi-agent work uses the rucher tools)")}`,
  );
  const settings = syncSettings(group);
  if (settings !== "unchanged") {
    lines.push(`  ${settings} .claude/settings.json (additionalDirectories = the repos)`);
  }
  lines.push(
    "",
    "Next: start claude in this directory, then `rucher status --watch` in a side pane.",
  );
  io.stdout(`${lines.join("\n")}\n`);
  return 0;
}
