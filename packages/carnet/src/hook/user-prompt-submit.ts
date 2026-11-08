import type { Carnet } from '../carnet.ts';
import type { Host, HostPromptPayload } from '../hosts/host.ts';
import type { Session } from '../sessions.ts';

export function handleUserPromptSubmit(
  carnet: Carnet,
  host: Host,
  payload: HostPromptPayload,
): Session {
  carnet.sessions.ensure(payload.session_id, payload.cwd);
  carnet.notes.recordActiveDay();
  return carnet.sessions.adoptTitle(payload.session_id, host.promptTitle(payload));
}
