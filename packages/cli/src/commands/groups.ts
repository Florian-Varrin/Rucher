import { resolve } from "node:path";
import { type GroupRef, isGroupRoot, readRegistry, unregisterGroups } from "@rucher/carnet";
import { paint } from "../color.ts";
import type { Io } from "../io.ts";

function missing(ref: GroupRef): boolean {
  return !isGroupRoot(ref.path);
}

export function groupsList(io: Io): number {
  const p = paint(io);
  const groups = readRegistry(io.env);
  if (groups.length === 0) {
    io.stdout(`${p.dim("no registered group")}\n`);
    return 0;
  }
  const width = Math.max(...groups.map((g) => g.name.length));
  const lines = groups.map(
    (g) =>
      `${p.bold(g.name.padEnd(width))}  ${g.path}${missing(g) ? `  ${p.yellow("missing")}` : ""}`,
  );
  io.stdout(`${lines.join("\n")}\n`);
  return 0;
}

export function groupsForget(ref: string, io: Io): number {
  const groups = readRegistry(io.env);
  const byPath = groups.filter((g) => g.path === resolve(io.cwd, ref));
  const matches = byPath.length ? byPath : groups.filter((g) => g.name === ref);
  if (matches.length === 0) {
    io.stderr(`error: no registered group named or located at "${ref}"\n`);
    return 1;
  }
  if (matches.length > 1) {
    io.stderr(
      `error: several groups are named "${ref}", forget one by path:\n${matches.map((g) => `  ${g.path}`).join("\n")}\n`,
    );
    return 1;
  }
  unregisterGroups([matches[0].path], io.env);
  io.stdout(`forgot ${matches[0].name} (${matches[0].path}); its meta directory is untouched\n`);
  return 0;
}

export function groupsPrune(io: Io): number {
  const gone = readRegistry(io.env).filter(missing);
  if (gone.length === 0) {
    io.stdout("nothing to prune\n");
    return 0;
  }
  unregisterGroups(
    gone.map((g) => g.path),
    io.env,
  );
  io.stdout(`pruned ${gone.length}:\n${gone.map((g) => `  ${g.name}  ${g.path}`).join("\n")}\n`);
  return 0;
}
