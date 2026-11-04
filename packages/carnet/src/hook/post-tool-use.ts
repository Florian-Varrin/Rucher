import type { Carnet } from '../carnet.ts';
import { repoNameFor } from '../group/locate.ts';
import type { HostToolPayload } from '../hosts/host.ts';
import { memoryMaxCharacters } from '../memory.ts';
import { memoryHalfLife } from '../notes.ts';
import type { HookEnv } from '../sessions.ts';

export function handleToolUse(
  carnet: Carnet,
  payload: HostToolPayload,
  env: HookEnv,
): string | undefined {
  // session_repos tracks the main conversation; a subagent's context is not it.
  if (payload.agent_id) return undefined;
  const repo = repoNameFor(carnet.requireGroup(), payload.path);
  if (!repo) return undefined;
  const session = carnet.sessions.ensure(payload.session_id, payload.cwd);
  return carnet.memory.forRepo(session, repo, {
    maxCharacters: memoryMaxCharacters(env.RUCHER_MEMORY_MAX_CHARACTERS),
    halfLifeDays: memoryHalfLife(env.RUCHER_MEMORY_HALF_LIFE_DAYS),
  });
}
