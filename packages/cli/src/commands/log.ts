import { type Carnet, type CarnetEvent, formatClock } from "@rucher/carnet";
import { paint } from "../color.ts";
import type { Io } from "../io.ts";
import { resolveSession } from "../session.ts";

export interface LogOptions {
  session?: string;
  count: number;
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

export function logOnce(carnet: Carnet, io: Io, options: LogOptions): void {
  const session = resolveSession(carnet, options.session);
  io.stdout(`${formatEvents(carnet.events.read(session.id, options.count), io)}\n`);
}
