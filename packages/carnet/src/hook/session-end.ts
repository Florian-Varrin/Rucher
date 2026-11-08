import type { Carnet } from '../carnet.ts';
import type { HostSessionEndPayload } from '../hosts/host.ts';
import type { Session } from '../sessions.ts';

export function handleSessionEnd(
  carnet: Carnet,
  payload: HostSessionEndPayload,
): Session | undefined {
  if (!carnet.sessions.get(payload.session_id)) return undefined;
  return carnet.sessions.end(payload.session_id);
}
