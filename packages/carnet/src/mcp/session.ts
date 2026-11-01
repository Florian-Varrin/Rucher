import type { Carnet } from '../carnet.ts';
import { CarnetError } from '../errors.ts';

export interface SessionResolverOptions {
  carnet: Carnet;
  env?: NodeJS.ProcessEnv | undefined;
  ppid?: number | undefined;
  cwd?: string | undefined;
}

export interface SessionResolver {
  resolve(override?: string): string;
}

export function createSessionResolver({
  carnet,
  env = process.env,
  ppid = process.ppid,
  cwd = process.cwd(),
}: SessionResolverOptions): SessionResolver {
  // Not cached: after --continue or the resume picker, the server env keeps a provisional
  // startup id, and the hook that records the real one can arrive after the server starts.
  function resolveOwn(): string {
    const hooked = carnet.sessions.byClaudePid(ppid);
    if (hooked) return hooked.id;
    const fromEnvironment = env.CLAUDE_CODE_SESSION_ID;
    if (fromEnvironment) return carnet.sessions.ensure(fromEnvironment, cwd).id;
    throw new CarnetError(
      'NO_SESSION',
      'Cannot tell which Claude session this is: pass `session`, or install the rucher SessionStart hook',
    );
  }

  return {
    resolve(override) {
      const id = override ? carnet.sessions.ensure(override, cwd).id : resolveOwn();
      carnet.sessions.touch(id);
      return id;
    },
  };
}
