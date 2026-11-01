import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { Carnet } from "@rucher/carnet";
import type { Io } from "../io.ts";
import { CliError } from "../session.ts";

export interface ResumeTarget {
  command: string;
  args: string[];
  cwd: string;
}

export function resumeTarget(carnet: Carnet, ref: string, io: Io): ResumeTarget {
  const session = carnet.sessions.byName(ref) ?? carnet.sessions.get(ref);
  if (!session) {
    const known = carnet.sessions
      .list()
      .map((s) => s.name)
      .filter(Boolean);
    throw new CliError(
      `Unknown session "${ref}"`,
      known.length ? `known sessions: ${known.join(", ")}` : "name one with session_new first",
    );
  }
  if (session.status === "dropped") io.stderr(`warning: session ${ref} was dropped\n`);
  // Claude Code stores conversations per project directory, so resume from the original cwd.
  const cwd = session.cwd && existsSync(session.cwd) ? session.cwd : io.cwd;
  return { command: "claude", args: ["--resume", session.id], cwd };
}

export function runTarget({ command, args, cwd }: ResumeTarget): number {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
