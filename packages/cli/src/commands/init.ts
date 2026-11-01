import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CarnetError, initGroup } from "@rucher/carnet";
import { paint } from "../color.ts";
import type { Io } from "../io.ts";
import { groupClaudeMd, groupSettings } from "../templates.ts";

export interface InitOptions {
  dir?: string;
  name?: string;
  repos?: string[];
}

function writeIfAbsent(path: string, content: string): boolean {
  if (existsSync(path)) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return true;
}

export function init(options: InitOptions, io: Io): number {
  const p = paint(io);
  const root = resolve(io.cwd, options.dir ?? ".");
  let group: ReturnType<typeof initGroup>;
  try {
    group = initGroup(root, { name: options.name, repos: options.repos, env: io.env });
  } catch (error) {
    if (error instanceof CarnetError && error.code === "GROUP_EXISTS") {
      io.stderr(`error: ${error.message}\n`);
      return 1;
    }
    throw error;
  }

  const lines = [
    `${p.bold(group.name)} initialised in ${group.root}`,
    `  repos: ${group.repos.length ? group.repos.join(", ") : "none yet, detected automatically as you add them"}`,
    `  database: ${group.dbPath}`,
  ];
  const claudeMd = join(group.root, "CLAUDE.md");
  const settings = join(group.root, ".claude", "settings.json");
  lines.push(
    writeIfAbsent(claudeMd, groupClaudeMd(group))
      ? "  wrote CLAUDE.md (group instructions template)"
      : `  kept existing CLAUDE.md ${p.dim("(add a line: multi-agent work uses the rucher tools)")}`,
  );
  if (group.repos.length === 0) {
    lines.push(
      "  no .claude/settings.json: nothing to grant until repos arrive (single-repo group, or add them later)",
    );
  } else {
    lines.push(
      writeIfAbsent(settings, groupSettings(group))
        ? "  wrote .claude/settings.json (additionalDirectories for the repos)"
        : `  kept existing .claude/settings.json ${p.dim(`(suggested: ${groupSettings(group).trim()})`)}`,
    );
  }
  lines.push(
    "",
    "Next: start claude in this directory or in a repo, then `rucher status --watch` in a side pane.",
  );
  io.stdout(`${lines.join("\n")}\n`);
  return 0;
}
