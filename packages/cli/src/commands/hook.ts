import {
  CarnetError,
  claudeCode,
  handleSessionEnd,
  handleSessionStart,
  handleUserPromptSubmit,
  type Host,
  openCarnet,
} from '@rucher/carnet';
import type { Io } from '../io.ts';

// These payloads follow Claude Code's hook format, the only host with hooks today.
const host: Host = claudeCode;

function runHook(io: Io, run: () => void): number {
  try {
    run();
  } catch (error) {
    if (error instanceof CarnetError && error.code === 'NO_GROUP') return 0;
    io.stderr(`rucher hook: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  return 0;
}

function withCarnet(
  cwd: string | undefined,
  io: Io,
  use: (carnet: ReturnType<typeof openCarnet>) => void,
): void {
  const carnet = openCarnet({ cwd: cwd ?? io.cwd, env: io.env });
  try {
    use(carnet);
  } finally {
    carnet.close();
  }
}

export function sessionStart(stdinText: string, io: Io): number {
  return runHook(io, () => {
    const payload = host.parseSessionPayload(stdinText);
    withCarnet(payload.cwd, io, (carnet) => {
      const { additionalContext } = handleSessionStart(carnet, payload, {
        host: host.id,
        processId: host.processId(io.env),
        RUCHER_PURGE_DAYS: io.env.RUCHER_PURGE_DAYS,
        RUCHER_SESSION_ID: io.env.RUCHER_SESSION_ID,
        RUCHER_SESSION_KIND: io.env.RUCHER_SESSION_KIND,
        RUCHER_SESSION_NAME: io.env.RUCHER_SESSION_NAME,
      });
      if (additionalContext) {
        const hookSpecificOutput = { hookEventName: 'SessionStart', additionalContext };
        io.stdout(`${JSON.stringify({ hookSpecificOutput })}\n`);
      }
    });
  });
}

export function subagentStart(stdinText: string, io: Io): number {
  return runHook(io, () => {
    const payload = host.parseSubagentPayload(stdinText);
    withCarnet(payload.cwd, io, (carnet) => {
      carnet.agents.pairSubagent(payload.session_id, payload.agent_id);
    });
  });
}

export function subagentStop(stdinText: string, io: Io): number {
  return runHook(io, () => {
    const payload = host.parseSubagentPayload(stdinText);
    withCarnet(payload.cwd, io, (carnet) => {
      carnet.agents.stopSubagent(payload.session_id, payload.agent_id, host.subagentNames(payload));
    });
  });
}

export function userPromptSubmit(stdinText: string, io: Io): number {
  return runHook(io, () => {
    const payload = host.parsePromptPayload(stdinText);
    withCarnet(payload.cwd, io, (carnet) => {
      handleUserPromptSubmit(carnet, host, payload);
    });
  });
}

export function sessionEnd(stdinText: string, io: Io): number {
  return runHook(io, () => {
    const payload = host.parseSessionEndPayload(stdinText);
    withCarnet(payload.cwd, io, (carnet) => {
      handleSessionEnd(carnet, payload);
    });
  });
}
