import type { Carnet } from '../carnet.ts';
import { CarnetError } from '../errors.ts';

const FULL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  function resolveOverride(override: string): string {
    try {
      return carnet.sessions.find(override).id;
    } catch (error) {
      if (!(error instanceof CarnetError) || error.code !== 'SESSION_NOT_FOUND') throw error;
      // A full Claude session id the hook never recorded still gets its row.
      if (FULL_ID.test(override)) return carnet.sessions.ensure(override, cwd).id;
      throw error;
    }
  }

  return {
    resolve(override) {
      const id = override ? resolveOverride(override) : resolveOwn();
      carnet.sessions.touch(id);
      return id;
    },
  };
}
