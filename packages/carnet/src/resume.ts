import type { Carnet } from "./carnet.ts";
import type { CarnetEvent } from "./events.ts";
import type { Session } from "./sessions.ts";
import { formatClock } from "./status/view.ts";

export const RESUME_EVENTS = 20;
export const RESUME_MAX_CHARS = 2000;

export interface ResumeContextOptions {
  events?: number;
  maxChars?: number;
}

export function formatEventLine(event: CarnetEvent): string {
  return [
    formatClock(new Date(event.at)),
    event.type,
    event.agent,
    event.link ?? event.note,
    event.commit?.slice(0, 7),
  ]
    .filter(Boolean)
    .join("  ");
}

export function sessionLabel(session: Session): string {
  const name = session.name ?? session.id;
  return session.purpose ? `${name} (${session.purpose})` : name;
}

export function resumeContext(
  carnet: Carnet,
  session: Session,
  { events = RESUME_EVENTS, maxChars = RESUME_MAX_CHARS }: ResumeContextOptions = {},
): string {
  const head = `Rucher session ${sessionLabel(session)}, state when resumed:\n\n${carnet.status.render(session)}`;
  const lines = carnet.events.read(session.id, events).map(formatEventLine);
  const build = () =>
    lines.length ? `${head}\n\nLast events\n${lines.map((l) => `  ${l}`).join("\n")}` : head;
  let text = build();
  // Drop the oldest events first: the latest steps matter most when picking up work.
  while (text.length > maxChars && lines.length > 0) {
    lines.shift();
    text = build();
  }
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}
