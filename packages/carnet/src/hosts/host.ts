import { CarnetError } from '../errors.ts';
import type { Group } from '../group/locate.ts';
import type { Session } from '../sessions.ts';
import { claudeCode } from './claude-code.ts';

export interface HostSessionPayload {
  session_id: string;
  cwd?: string | undefined;
  source?: string | undefined;
  session_title?: string | undefined;
}

export interface HostPromptPayload {
  session_id: string;
  cwd?: string | undefined;
  session_title?: string | undefined;
  transcript_path?: string | undefined;
}

export interface HostSubagentPayload {
  session_id: string;
  agent_id: string;
  agent_type?: string | undefined;
  cwd?: string | undefined;
}

export interface ResumeCommand {
  command: string;
  args: string[];
}

export interface ContextFile {
  path: string;
  sync(group: Group, mode: 'merge' | 'exact'): ContextFileResult;
}

export type ContextFileResult = 'written' | 'updated' | 'unchanged' | 'no-markers';

export interface Host {
  id: string;
  displayName: string;
  processId(env: NodeJS.ProcessEnv): number | null;
  sessionIdFromEnvironment(env: NodeJS.ProcessEnv): string | undefined;
  projectDirectory(env: NodeJS.ProcessEnv): string | undefined;
  parseSessionPayload(json: string): HostSessionPayload;
  parsePromptPayload(json: string): HostPromptPayload;
  parseSubagentPayload(json: string): HostSubagentPayload;
  promptTitle(payload: HostPromptPayload): string | undefined;
  resumeCommand(session: Session): ResumeCommand;
  renameInstruction(name: string): string;
  contextFiles: readonly ContextFile[];
}

export const DEFAULT_HOST = 'claude-code';

const HOSTS: Readonly<Record<string, Host>> = { [claudeCode.id]: claudeCode };

export function allHosts(): Host[] {
  return Object.values(HOSTS);
}

export function hostById(id: string): Host {
  const host = HOSTS[id];
  if (!host) {
    throw new CarnetError(
      'UNKNOWN_HOST',
      `Unknown host "${id}" (available: ${Object.keys(HOSTS).join(', ')})`,
    );
  }
  return host;
}
