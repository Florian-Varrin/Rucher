import {
  type Carnet,
  type CarnetEvent,
  formatClock,
  workspaceLabel,
  type Session,
} from '@rucher/carnet';
import { paint } from '../color.ts';
import type { Io } from '../io.ts';
import { resolveSession } from '../session.ts';

export interface LogOptions {
  session?: string | undefined;
  count: number;
  md?: boolean | undefined;
  agents?: boolean | undefined;
}

export function formatEvents(events: CarnetEvent[], io: Io): string {
  const colors = paint(io);
  if (events.length === 0) return colors.dim('no events yet');
  return events
    .map((event) => {
      const parts = [
        colors.dim(formatClock(new Date(event.at))),
        colors.bold(event.type.padEnd(9)),
        event.agent ?? '',
        event.link ?? event.note ?? '',
        event.commit ? colors.cyan(event.commit.slice(0, 7)) : '',
      ];
      return parts.filter(Boolean).join('  ');
    })
    .join('\n');
}

function formatDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function markdownEvent(event: CarnetEvent): string {
  const parts = [`${formatClock(new Date(event.at))} **${event.type}**`];
  if (event.agent) parts.push(`\`${event.agent}\``);
  const detail = [
    event.note,
    event.link ? `[report](${event.link})` : null,
    event.commit ? `\`${event.commit.slice(0, 7)}\`` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return `- ${parts.join(' ')}${detail ? `: ${detail}` : ''}`;
}

export function formatEventsMarkdown(events: CarnetEvent[], title: string): string {
  const lines = [`# Journal: ${title}`];
  if (events.length === 0) return `${lines[0]}\n\nNo events yet.`;
  let day = '';
  for (const event of events) {
    const current = formatDay(new Date(event.at));
    if (current !== day) {
      day = current;
      lines.push('', `## ${day}`, '');
    }
    lines.push(markdownEvent(event));
  }
  return lines.join('\n');
}

function sessionTitle(carnet: Carnet, session: Session): string {
  return `${workspaceLabel(carnet.workspace)} · ${session.name ?? session.id.slice(0, 8)}`;
}

export function logOnce(carnet: Carnet, io: Io, options: LogOptions): void {
  const session = resolveSession(carnet, options.session);
  const events = carnet.events.read(session.id, options.count, options.agents);
  io.stdout(
    `${options.md ? formatEventsMarkdown(events, sessionTitle(carnet, session)) : formatEvents(events, io)}\n`,
  );
}
