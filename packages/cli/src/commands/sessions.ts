import { type Carnet, formatClock, type Session } from "@rucher/carnet";
import { paint } from "../color.ts";
import type { Io } from "../io.ts";
import { CliError } from "../session.ts";
import { sessionWhere } from "./status.ts";

export interface SessionsOptions {
  all?: boolean;
  now?: Date;
}

function lastActive(at: string, now: Date): string {
  const date = new Date(at);
  return date.toDateString() === now.toDateString()
    ? formatClock(date)
    : date.toISOString().slice(0, 10);
}

function row(carnet: Carnet, session: Session, now: Date): string[] {
  const open = carnet.agents.list(session.id).length;
  return [
    session.name ?? session.id.slice(0, 8),
    session.status,
    sessionWhere(carnet, session) ?? "",
    lastActive(session.lastActiveAt, now),
    open ? `${open} agent${open > 1 ? "s" : ""}` : "",
    session.purpose ?? "",
  ];
}

export function sessionsOnce(carnet: Carnet, io: Io, options: SessionsOptions = {}): void {
  const p = paint(io);
  const sessions = carnet.sessions.list({
    includeTemporary: options.all,
    includeDropped: options.all,
  });
  if (sessions.length === 0) {
    const hint = options.all ? "" : " (temporary ones are hidden, use --all)";
    io.stdout(`${p.dim(`no named session yet${hint}`)}\n`);
    return;
  }
  const now = options.now ?? new Date();
  const rows = sessions.map((s) => row(carnet, s, now));
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  const lines = rows.map((r, index) => {
    const cells = r.map((cell, i) => (i < r.length - 1 ? cell.padEnd(widths[i]) : cell));
    const [name, status, ...rest] = cells;
    const muted = sessions[index].status !== "active";
    const line = [p.bold(name), muted ? p.dim(status) : status, ...rest].join("  ");
    return line.trimEnd();
  });
  io.stdout(`${lines.join("\n")}\n`);
}

function findSession(carnet: Carnet, reference: string): Session {
  const session = carnet.sessions.byName(reference) ?? carnet.sessions.get(reference);
  if (!session)
    throw new CliError(
      `Unknown session "${reference}"`,
      "pass a session name or id, see rucher sessions --all",
    );
  return session;
}

export function sessionsMerge(
  carnet: Carnet,
  fromReference: string,
  intoReference: string,
  io: Io,
): void {
  const from = findSession(carnet, fromReference);
  const into = findSession(carnet, intoReference);
  const result = carnet.sessions.merge(from.id, into.id);
  const label = (session: Session) => session.name ?? session.id.slice(0, 8);
  const lines = [
    `merged ${label(from)} into ${label(result.session)}`,
    `  agents moved: ${result.movedAgents.join(", ") || "none"}`,
    ...(result.closedAgents.length
      ? [`  agents closed (name already used): ${result.closedAgents.join(", ")}`]
      : []),
    `  events moved: ${result.movedEvents}`,
    `  table line moved: ${result.movedTable ? "yes" : "no"}`,
  ];
  io.stdout(`${lines.join("\n")}\n`);
}
