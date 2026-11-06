import {
  type Carnet,
  type Group,
  type GroupResolution,
  openResolvedCarnet,
  requireGroup,
  resolveGroup,
} from '@rucher/carnet';
import type { Io } from './io.ts';

export const groupArgument = {
  group: {
    type: 'string',
    alias: 'g',
    description:
      'Group name (default: from RUCHER_GROUP, the run directory or the repo you are in)',
  },
} as const;

// Said only when the directory picked the group, so a wrong guess is visible before it acts.
export function announceGroup(io: Io, resolution: GroupResolution): void {
  if (!resolution.group) return;
  if (resolution.origin === 'run-directory') {
    io.stderr(`group ${resolution.group.name} (from its run directory)\n`);
  } else if (resolution.origin === 'repo' && resolution.repo) {
    io.stderr(`group ${resolution.group.name} (from ${resolution.repo.name})\n`);
  }
}

// An empty list without a group would read as lost data.
export function warnNoGroup(carnet: Carnet, io: Io): void {
  if (!carnet.group) io.stderr('no group here: pass -g after the subcommand\n');
}

export function openCliCarnet(io: Io, group?: string): Carnet {
  const { carnet, resolution } = openResolvedCarnet({ cwd: io.cwd, env: io.env, group });
  announceGroup(io, resolution);
  return carnet;
}

export function currentGroup(io: Io, group?: string): Group {
  const resolution = resolveGroup({ cwd: io.cwd, env: io.env, group });
  const found = requireGroup(resolution.group);
  announceGroup(io, resolution);
  return found;
}
