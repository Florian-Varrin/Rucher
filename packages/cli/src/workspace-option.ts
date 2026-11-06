import {
  type Carnet,
  type Workspace,
  type WorkspaceResolution,
  openResolvedCarnet,
  requireWorkspace,
  resolveWorkspace,
} from '@rucher/carnet';
import type { Io } from './io.ts';

export const workspaceArgument = {
  ws: {
    type: 'string',
    description:
      'Workspace name (default: from RUCHER_WS, the run directory or the repo you are in)',
  },
} as const;

// citty drops a parent's arguments when it runs a named subcommand.
export function forwardWorkspace({ args }: { args: { ws?: string | undefined } }): void {
  if (args.ws) process.env.RUCHER_WS = args.ws;
}

// Said only when the directory picked the workspace, so a wrong guess is visible before it acts.
export function announceWorkspace(io: Io, resolution: WorkspaceResolution): void {
  if (!resolution.workspace) return;
  if (resolution.origin === 'run-directory') {
    io.stderr(`workspace ${resolution.workspace.name} (from its run directory)\n`);
  } else if (resolution.origin === 'repo' && resolution.repo) {
    io.stderr(`workspace ${resolution.workspace.name} (from ${resolution.repo.name})\n`);
  }
}

// An empty list without a workspace would read as lost data.
export function warnNoWorkspace(carnet: Carnet, io: Io): void {
  if (!carnet.workspace) io.stderr('no workspace here: pass --ws\n');
}

export function openCliCarnet(io: Io, workspace?: string): Carnet {
  const { carnet, resolution } = openResolvedCarnet({ cwd: io.cwd, env: io.env, workspace });
  announceWorkspace(io, resolution);
  return carnet;
}

export function currentWorkspace(io: Io, workspace?: string): Workspace {
  const resolution = resolveWorkspace({ cwd: io.cwd, env: io.env, workspace });
  const found = requireWorkspace(resolution.workspace);
  announceWorkspace(io, resolution);
  return found;
}
