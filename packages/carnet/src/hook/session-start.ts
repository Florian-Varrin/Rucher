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

export function handleSessionStart(
  carnet: Carnet,
  payload: HookSessionPayload,
  env: HookEnv,
): SessionStartResult {
  let session = carnet.sessions.upsertFromHook(payload, env);
  const event = payload.source ? SOURCE_EVENTS[payload.source] : undefined;
  if (event) carnet.events.log(session.id, { type: event });
  if (session.status === 'archived') session = carnet.sessions.setStatus(session.id, 'idle');
  carnet.sessions.purge(session.id, purgeDays(env.RUCHER_PURGE_DAYS));
  if (payload.source !== 'resume') return { session };
  return { session, additionalContext: resumeContext(carnet, session) };
}
