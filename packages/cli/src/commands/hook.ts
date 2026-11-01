import { CarnetError, handleSessionStart, openCarnet, parseHookPayload } from "@rucher/carnet";
import type { Io } from "../io.ts";

export function sessionStart(stdinText: string, io: Io): number {
  try {
    const payload = parseHookPayload(stdinText);
    const carnet = openCarnet({ cwd: payload.cwd ?? io.cwd, env: io.env });
    try {
      handleSessionStart(carnet, payload, { CLAUDE_PID: io.env.CLAUDE_PID });
    } finally {
      carnet.close();
    }
  } catch (error) {
    if (error instanceof CarnetError && error.code === "NO_GROUP") return 0;
    io.stderr(`rucher hook: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  return 0;
}
