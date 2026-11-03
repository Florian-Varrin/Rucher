import type { Carnet } from '../carnet.ts';
import type { SessionEventType } from '../events.ts';
import {
  compactReminder,
  OUTSIDE_RUCHER_CONTEXT,
  OUTSIDE_RUCHER_NOTICE,
  RULES_UPDATED_NOTICE,
  rulesVersion,
} from '../prompt/prompt.ts';
import { hostById } from '../hosts/host.ts';
import { purgeDays } from '../purge.ts';
import { resumeContext } from '../resume.ts';
import type { HookEnv, HookSessionPayload, Session } from '../sessions.ts';

export interface SessionStartResult {
  session: Session;
  additionalContext?: string;
  contextParts: string[];
  notices: string[];
}

const SOURCE_EVENTS: Readonly<Record<string, SessionEventType>> = {
  startup: 'session.started',
  resume: 'session.resumed',
  fork: 'session.forked',
};

// A fork gets a new id from the host; the launcher's env still carries the parent's.
function adoptFork(carnet: Carnet, session: Session, env: HookEnv): Session {
  const parentId = env.RUCHER_SESSION_ID;
  if (!parentId || parentId === session.id || !carnet.sessions.get(parentId)) return session;
  let fork = carnet.sessions.setParent(session.id, parentId);
  const kind = env.RUCHER_SESSION_KIND;
  if (kind === 'active' || kind === 'temp') {
    fork = carnet.sessions.setKind(session.id, kind, env.RUCHER_SESSION_NAME || null);
  }
  return fork;
}

export function handleSessionStart(
  carnet: Carnet,
  payload: HookSessionPayload,
  env: HookEnv,
): SessionStartResult {
  let session = carnet.sessions.upsertFromHook(payload, env);
  const source = payload.source ?? '';
  if (source === 'fork') session = adoptFork(carnet, session, env);
  const event = SOURCE_EVENTS[source];
  if (event) carnet.events.log(session.id, { type: event });
  session = carnet.sessions.setStatus(session.id, 'running');
  carnet.sessions.purge(session.id, purgeDays(env.RUCHER_PURGE_DAYS));

  const promptEnv = { RUCHER_HOME: env.RUCHER_HOME };
  const launchedVersion = env.RUCHER_PROMPT_VERSION || null;
  const contextParts: string[] = [];
  const notices: string[] = [];
  if (hostById(session.host).rendersSystemPrompt(source)) {
    session = carnet.sessions.recordPromptVersion(session.id, launchedVersion);
  }
  if (source === 'resume') contextParts.push(resumeContext(carnet, session));
  if (source === 'compact' && !launchedVersion) {
    contextParts.push(compactReminder(carnet.group, promptEnv));
  } else if (!env.RUCHER_SESSION_ID && !session.promptVersion) {
    contextParts.push(OUTSIDE_RUCHER_CONTEXT);
    notices.push(OUTSIDE_RUCHER_NOTICE);
  } else if (
    session.promptVersion &&
    session.promptVersion !== rulesVersion(carnet.group, promptEnv)
  ) {
    notices.push(RULES_UPDATED_NOTICE);
  }
  const additionalContext = contextParts.length ? contextParts.join('\n\n') : undefined;
  return { session, contextParts, notices, ...(additionalContext ? { additionalContext } : {}) };
}
