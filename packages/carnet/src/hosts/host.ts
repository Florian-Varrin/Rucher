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
  description?: string | undefined;
  agent_transcript_path?: string | undefined;
}

export interface HostSessionEndPayload {
  session_id: string;
  cwd?: string | undefined;
  reason?: string | undefined;
}

export interface HostToolPayload {
  session_id: string;
  cwd?: string | undefined;
  tool_name?: string | undefined;
  agent_id?: string | undefined;
  path?: string | undefined;
}

export interface ResumeCommand {
  command: string;
  args: string[];
}

export interface LaunchOptions {
  name?: string | null | undefined;
  appendPromptFile?: string | undefined;
  passthrough?: readonly string[] | undefined;
  directories?: readonly string[] | undefined;
}

export interface HostRender {
  written: string[];
  removed: string[];
}

export interface Host {
  id: string;
  displayName: string;
  processId(env: NodeJS.ProcessEnv): number | null;
  sessionIdFromEnvironment(env: NodeJS.ProcessEnv): string | undefined;
  projectDirectory(env: NodeJS.ProcessEnv): string | undefined;
  parseSessionPayload(json: string): HostSessionPayload;
  parsePromptPayload(json: string): HostPromptPayload;
  parseSubagentPayload(json: string): HostSubagentPayload;
  parseSessionEndPayload(json: string): HostSessionEndPayload;
  parseToolPayload(json: string): HostToolPayload;
  subagentNames(payload: HostSubagentPayload): string[];
  subagentInheritsContext(payload: HostSubagentPayload): boolean;
  rendersSystemPrompt(source: string): boolean;
  promptTitle(payload: HostPromptPayload): string | undefined;
  launchCommand(sessionId: string, options?: LaunchOptions): ResumeCommand;
  resumeCommand(session: Session, options?: LaunchOptions): ResumeCommand;
  forkCommand(parent: Session, options?: LaunchOptions): ResumeCommand;
  renameInstruction(name: string): string;
  transcriptFiles(session: Session, env?: NodeJS.ProcessEnv): string[];
  renderRunDirectory(group: Group): HostRender;
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
