import type { Carnet } from '../carnet.ts';
import type { SessionEventType } from '../events.ts';
import { purgeDays } from '../purge.ts';
import { resumeContext } from '../resume.ts';
import type { HookEnv, HookSessionPayload, Session } from '../sessions.ts';

export interface SessionStartResult {
  session: Session;
  additionalContext?: string;
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
  if (payload.source === 'fork') session = adoptFork(carnet, session, env);
  const event = payload.source ? SOURCE_EVENTS[payload.source] : undefined;
  if (event) carnet.events.log(session.id, { type: event });
  session = carnet.sessions.setStatus(session.id, 'running');
  carnet.sessions.purge(session.id, purgeDays(env.RUCHER_PURGE_DAYS));
  if (payload.source !== 'resume') return { session };
  return { session, additionalContext: resumeContext(carnet, session) };
}
