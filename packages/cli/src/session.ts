import type { Carnet, Session } from "@rucher/carnet";

export class CliError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export function resolveSession(carnet: Carnet, ref?: string): Session {
  if (ref) {
    const session = carnet.sessions.get(ref) ?? carnet.sessions.byName(ref);
    if (session) return session;
    const known = carnet.sessions
      .list()
      .map((s) => s.name)
      .filter(Boolean);
    throw new CliError(
      `Unknown session "${ref}"`,
      known.length ? `known sessions: ${known.join(", ")}` : "no named session in this group yet",
    );
  }
  const session = carnet.sessions.default();
  if (!session) throw new CliError("No session in this group yet", "start claude inside the group");
  return session;
}
