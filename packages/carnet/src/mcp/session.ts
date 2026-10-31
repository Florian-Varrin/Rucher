import type { Carnet } from "../carnet.ts";
import { CarnetError } from "../errors.ts";

export interface SessionResolverOptions {
  carnet: Carnet;
  env?: NodeJS.ProcessEnv;
  ppid?: number;
  cwd?: string;
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
  let cached: string | undefined;

  function resolveOwn(): string {
    if (cached) return cached;
    const fromEnv = env.CLAUDE_CODE_SESSION_ID;
    if (fromEnv) {
      cached = carnet.sessions.ensure(fromEnv, cwd).id;
      return cached;
    }
    const byPid = carnet.sessions.byClaudePid(ppid);
    if (byPid) {
      cached = byPid.id;
      return cached;
    }
    throw new CarnetError(
      "NO_SESSION",
      "Cannot tell which Claude session this is: pass `session`, or install the rucher SessionStart hook",
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
