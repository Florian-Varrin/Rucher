import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Group } from '../group/group.ts';
import { corePromptPath, promptsDirectory } from '../paths.ts';
import { shortId, type SessionKind } from '../sessions.ts';
import { CORE_RULES } from './core-rules.ts';

export const PROMPT_FILE = 'prompt.md';

export interface PromptSession {
  id: string;
  name: string | null;
  kind: SessionKind;
}

export interface AssembledPrompt {
  text: string;
  version: string;
}

export interface AppendPromptFile {
  path: string;
  version: string;
}

function readIfPresent(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const content = readFileSync(path, 'utf8').trim();
  return content || undefined;
}

export function baseRules(env: NodeJS.ProcessEnv = process.env): string {
  return readIfPresent(corePromptPath(env)) ?? CORE_RULES;
}

export function groupRules(group: Group | null): string | undefined {
  return group ? readIfPresent(join(group.definition, PROMPT_FILE)) : undefined;
}

export function rulesText(group: Group | null, env: NodeJS.ProcessEnv = process.env): string {
  const extra = groupRules(group);
  const base = `Rucher rules, always follow them:\n${baseRules(env)}`;
  return extra && group ? `${base}\n\nRules of the ${group.name} group:\n${extra}` : base;
}

// The identity block is left out so that renaming a session doesn't read as a rules change.
export function rulesVersion(group: Group | null, env: NodeJS.ProcessEnv = process.env): string {
  return createHash('sha256').update(rulesText(group, env)).digest('hex').slice(0, 12);
}

export function assemblePrompt(
  group: Group | null,
  session: PromptSession,
  env: NodeJS.ProcessEnv = process.env,
): AssembledPrompt {
  const label = session.name ?? shortId(session.id);
  const identity = group
    ? `This is the Rucher session ${label} (${session.kind}) of the ${group.name} group.`
    : `This is the Rucher session ${label} (${session.kind}), outside any group.`;
  return { text: `${rulesText(group, env)}\n\n${identity}\n`, version: rulesVersion(group, env) };
}

export function appendPromptFile(
  group: Group | null,
  session: PromptSession,
  env: NodeJS.ProcessEnv = process.env,
): AppendPromptFile {
  const { text, version } = assemblePrompt(group, session, env);
  const directory = promptsDirectory(env);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${session.id}.md`);
  writeFileSync(path, text);
  return { path, version };
}

export function compactReminder(group: Group | null, env: NodeJS.ProcessEnv = process.env): string {
  return `The conversation was just compacted and this session was not started by rucher, so its system prompt no longer holds the Rucher rules. ${rulesText(group, env)}`;
}

export function outsideRucherContext(
  group: Group | null,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return `This session was started without rucher, so its system prompt does not hold the Rucher rules. ${rulesText(group, env)}`;
}

export const OUTSIDE_RUCHER_NOTICE =
  'rucher: session started without rucher, the Rucher rules are not in its system prompt (use rucher new, tmp or resume)';

export const RULES_UPDATED_NOTICE =
  'rucher: rules updated, will apply after the next compaction or in a new session';

export const SUBAGENT_RULES =
  'Rucher rules for sub-agents: never commit, push or stash. When your task asks for a report, write it to the file it names. If your prompt names you as a Carnet agent, call agent_update at meaningful progress and agent_done as your last tool action, then reply with one line.';
