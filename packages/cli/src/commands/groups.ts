import { listGroups } from '@rucher/carnet';
import { paint } from '../color.ts';
import type { Io } from '../io.ts';

export function groupsList(io: Io): number {
  const colors = paint(io);
  const groups = listGroups(io.env);
  if (groups.length === 0) {
    io.stdout(`${colors.dim('no group yet')}\n`);
    return 0;
  }
  const width = Math.max(...groups.map((group) => group.name.length));
  const lines = groups.map(
    (group) =>
      `${colors.bold(group.name.padEnd(width))}  ${group.repos.length} repo${group.repos.length === 1 ? '' : 's'}  ${colors.dim(group.workspace)}`,
  );
  io.stdout(`${lines.join('\n')}\n`);
  return 0;
}
