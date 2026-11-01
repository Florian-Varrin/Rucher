import type { Carnet } from '../carnet.ts';
import { resumeContext } from '../resume.ts';
import type { HookEnv, HookSessionPayload, Session } from '../sessions.ts';

export function parseHookPayload(json: string): HookSessionPayload {
  const data = JSON.parse(json) as Record<string, unknown>;
  if (typeof data.session_id !== 'string' || !data.session_id) {
    throw new TypeError('Hook payload has no session_id');
  }
  return {
    session_id: data.session_id,
    cwd: typeof data.cwd === 'string' ? data.cwd : undefined,
    source: typeof data.source === 'string' ? data.source : undefined,
    session_title: typeof data.session_title === 'string' ? data.session_title : undefined,
  };
}

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
  if (payload.source !== 'resume') return { session };
  return { session, additionalContext: resumeContext(carnet, session) };
}
