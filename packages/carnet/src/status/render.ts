import type { TableItem } from '../table.ts';
import { EMOJI, LEGEND, MAIN_WORKING_EMOJI } from './model.ts';
import type { StatusLine, StatusView } from './view.ts';

export const MAIN_WORKING_SUFFIX = '(main working, not ready)';

export function renderTableLine(item: TableItem): string {
  if (item.mainWorking) return `${MAIN_WORKING_EMOJI} ${item.text} ${MAIN_WORKING_SUFFIX}`;
  return `${EMOJI[item.status ?? 'discussing']} ${item.text}`;
}

export function renderAgentLine(line: StatusLine): string {
  return line.note ? `${line.emoji} ${line.name} — ${line.note}` : `${line.emoji} ${line.name}`;
}

export function renderSections(view: StatusView): string {
  const out: string[] = [];
  if (view.table) {
    out.push('On the table', `  ${renderTableLine(view.table)}`, '');
  }
  out.push('Waiting on you');
  if (view.waiting.length === 0) out.push('  nothing');
  view.waiting.forEach((line, index) => {
    out.push(`  ${index + 1}. ${renderAgentLine(line)}`);
  });
  out.push('', 'Running');
  if (view.running.length === 0) out.push('  nothing');
  for (const line of view.running) out.push(`  ${renderAgentLine(line)}`);
  return out.join('\n');
}

export function renderStatus(view: StatusView): string {
  return [view.time, '', renderSections(view), '', LEGEND].join('\n');
}
