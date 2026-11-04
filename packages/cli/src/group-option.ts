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
    description: 'Group name (default: from RUCHER_GROUP, the workspace or the repo you are in)',
  },
} as const;

// Said only when the directory picked the group, so a wrong guess is visible before it acts.
export function announceGroup(io: Io, resolution: GroupResolution): void {
  if (!resolution.group) return;
  if (resolution.origin === 'workspace') {
    io.stderr(`group ${resolution.group.name} (from its workspace)\n`);
  } else if (resolution.origin === 'repo' && resolution.repo) {
    io.stderr(`group ${resolution.group.name} (from ${resolution.repo.name})\n`);
  }
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
