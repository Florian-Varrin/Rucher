import { resolve } from 'node:path';
import { type GroupReference, isGroupRoot, readRegistry, unregisterGroups } from '@rucher/carnet';
import { paint } from '../color.ts';
import type { Io } from '../io.ts';

function missing(reference: GroupReference): boolean {
  return !isGroupRoot(reference.path);
}

export function groupsList(io: Io): number {
  const colors = paint(io);
  const groups = readRegistry(io.env);
  if (groups.length === 0) {
    io.stdout(`${colors.dim('no registered group')}\n`);
    return 0;
  }
  const width = Math.max(...groups.map((group) => group.name.length));
  const lines = groups.map(
    (group) =>
      `${colors.bold(group.name.padEnd(width))}  ${group.path}${missing(group) ? `  ${colors.yellow('missing')}` : ''}`,
  );
  io.stdout(`${lines.join('\n')}\n`);
  return 0;
}

export function groupsForget(reference: string, io: Io): number {
  const groups = readRegistry(io.env);
  const byPath = groups.filter((group) => group.path === resolve(io.cwd, reference));
  const matches = byPath.length ? byPath : groups.filter((group) => group.name === reference);
  const [match] = matches;
  if (!match) {
    io.stderr(`error: no registered group named or located at "${reference}"\n`);
    return 1;
  }
  if (matches.length > 1) {
    io.stderr(
      `error: several groups are named "${reference}", forget one by path:\n${matches.map((group) => `  ${group.path}`).join('\n')}\n`,
    );
    return 1;
  }
  unregisterGroups([match.path], io.env);
  io.stdout(`forgot ${match.name} (${match.path}); its meta directory is untouched\n`);
  return 0;
}

export function groupsPrune(io: Io): number {
  const gone = readRegistry(io.env).filter(missing);
  if (gone.length === 0) {
    io.stdout('nothing to prune\n');
    return 0;
  }
  unregisterGroups(
    gone.map((group) => group.path),
    io.env,
  );
  io.stdout(`pruned ${gone.length}:\n${gone.map((g) => `  ${g.name}  ${g.path}`).join('\n')}\n`);
  return 0;
}
