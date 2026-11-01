import { type Carnet, type CarnetEvent, formatClock, type Session } from "@rucher/carnet";
import { paint } from "../color.ts";
import type { Io } from "../io.ts";
import { resolveSession } from "../session.ts";

export interface LogOptions {
  session?: string;
  count: number;
  md?: boolean;
}

export function formatEvents(events: CarnetEvent[], io: Io): string {
  const p = paint(io);
  if (events.length === 0) return p.dim("no events yet");
  return events
    .map((e) => {
      const parts = [
        p.dim(formatClock(new Date(e.at))),
        p.bold(e.type.padEnd(9)),
        e.agent ?? "",
        e.link ?? e.note ?? "",
        e.commit ? p.cyan(e.commit.slice(0, 7)) : "",
      ];
      return parts.filter(Boolean).join("  ");
    })
    .join("\n");
}

function formatDay(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

function markdownEvent(e: CarnetEvent): string {
  const parts = [`${formatClock(new Date(e.at))} **${e.type}**`];
  if (e.agent) parts.push(`\`${e.agent}\``);
  const detail = [
    e.note,
    e.link ? `[report](${e.link})` : null,
    e.commit ? `\`${e.commit.slice(0, 7)}\`` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return `- ${parts.join(" ")}${detail ? `: ${detail}` : ""}`;
}

export function formatEventsMarkdown(events: CarnetEvent[], title: string): string {
  const lines = [`# Journal: ${title}`];
  if (events.length === 0) return `${lines[0]}\n\nNo events yet.`;
  let day = "";
  for (const e of events) {
    const current = formatDay(new Date(e.at));
    if (current !== day) {
      day = current;
      lines.push("", `## ${day}`, "");
    }
    lines.push(markdownEvent(e));
  }
  return lines.join("\n");
}

function sessionTitle(carnet: Carnet, session: Session): string {
  return `${carnet.group.name} · ${session.name ?? session.id.slice(0, 8)}`;
}

export function logOnce(carnet: Carnet, io: Io, options: LogOptions): void {
  const session = resolveSession(carnet, options.session);
  const events = carnet.events.read(session.id, options.count);
  io.stdout(
    `${options.md ? formatEventsMarkdown(events, sessionTitle(carnet, session)) : formatEvents(events, io)}\n`,
  );
}
