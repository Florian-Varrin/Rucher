import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { type Carnet, hostById } from '@rucher/carnet';
import type { Io } from '../io.ts';
import { findSession } from '../session.ts';

export interface ResumeTarget {
  command: string;
  args: string[];
  cwd: string;
}

export function resumeTarget(carnet: Carnet, reference: string, io: Io): ResumeTarget {
  const session = findSession(carnet, reference);
  if (session.status === 'dropped') io.stderr(`warning: session ${reference} was dropped\n`);
  // Hosts store conversations per project directory, so resume from the original cwd.
  const cwd = session.cwd && existsSync(session.cwd) ? session.cwd : io.cwd;
  return { ...hostById(session.host).resumeCommand(session), cwd };
}

export function runTarget({ command, args, cwd }: ResumeTarget): number {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
