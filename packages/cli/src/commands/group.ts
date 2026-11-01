import { basename, resolve } from "node:path";
import { addGroupRepo, CarnetError, locateGroup } from "@rucher/carnet";
import { paint } from "../color.ts";
import type { Io } from "../io.ts";
import { syncClaudeMd, syncSettings } from "./init.ts";

export function groupShow(io: Io): number {
  const p = paint(io);
  const group = locateGroup({ cwd: io.cwd, env: io.env });
  const repos = group.repos.length
    ? group.repos.map((r) => `  ${basename(r)}  ${p.dim(r)}`).join("\n")
    : `  ${p.dim("none")}`;
  io.stdout(`${p.bold(group.name)}  ${p.dim(group.root)}\nrepos:\n${repos}\n`);
  return 0;
}

export function groupAdd(repo: string, io: Io): number {
  const found = locateGroup({ cwd: io.cwd, env: io.env });
  try {
    const group = addGroupRepo(found.root, resolve(io.cwd, repo));
    const settings = syncSettings(group);
    const claudeMd = syncClaudeMd(group);
    const notes = [
      settings === "unchanged" ? null : `${settings} .claude/settings.json`,
      claudeMd === "unchanged"
        ? null
        : claudeMd === "no-markers"
          ? "CLAUDE.md has no rucher:repos markers, list it there yourself"
          : `${claudeMd} CLAUDE.md`,
    ].filter(Boolean);
    io.stdout(
      `added ${basename(resolve(io.cwd, repo))} to ${group.name}${notes.length ? ` (${notes.join(", ")})` : ""}\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof CarnetError) {
      io.stderr(`error: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}
