import type { Carnet } from '../carnet.ts';
import { purgeDays } from '../purge.ts';
import { resumeContext } from '../resume.ts';
import type { HookEnv, HookSessionPayload, Session } from '../sessions.ts';

export interface SessionStartResult {
  session: Session;
  additionalContext?: string;
}

export function handleSessionStart(
  carnet: Carnet,
  payload: HookSessionPayload,
  env: HookEnv,
): SessionStartResult {
  const session = carnet.sessions.upsertFromHook(payload, env);
  carnet.sessions.purge(session.id, purgeDays(env.RUCHER_PURGE_DAYS));
  if (payload.source !== 'resume') return { session };
  return { session, additionalContext: resumeContext(carnet, session) };
}
