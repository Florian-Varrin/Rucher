import {
  ambiguousWorkspaceContext,
  CarnetError,
  claudeCode,
  handleSessionEnd,
  handleSessionStart,
  handleToolUse,
  handleUserPromptSubmit,
  type Host,
  openCarnet,
  SUBAGENT_RULES,
} from '@rucher/carnet';
import type { Io } from '../io.ts';

// These payloads follow Claude Code's hook format, the only host with hooks today.
const host: Host = claudeCode;

function runHook(io: Io, run: () => void, hookEventName?: string): number {
  try {
    run();
  } catch (error) {
    if (error instanceof CarnetError && error.code === 'NO_WORKSPACE') return 0;
    if (error instanceof CarnetError && error.code === 'WORKSPACE_AMBIGUOUS') {
      if (hookEventName) {
        io.stderr(`rucher: ${error.message}\n`);
        const additionalContext = ambiguousWorkspaceContext(error.message);
        io.stdout(
          `${JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } })}\n`,
        );
      }
      return 0;
    }
    io.stderr(`rucher hook: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  return 0;
}

function withCarnet(
  payload: { cwd?: string | undefined; session_id?: string | undefined },
  io: Io,
  use: (carnet: ReturnType<typeof openCarnet>) => void,
): void {
  const carnet = openCarnet({
    cwd: payload.cwd ?? io.cwd,
    env: io.env,
    sessionId: payload.session_id,
  });
  try {
    // The plugin's hooks run in every Claude Code session: only workspace sessions and those
    // launched by rucher are Rucher's.
    const known = payload.session_id ? carnet.sessions.get(payload.session_id) : undefined;
    if (!carnet.workspace && !io.env.RUCHER_SESSION_ID && !known) return;
    use(carnet);
  } finally {
    carnet.close();
  }
}

export function sessionStart(stdinText: string, io: Io): number {
  return runHook(
    io,
    () => {
      const payload = host.parseSessionPayload(stdinText);
      withCarnet(payload, io, (carnet) => {
        const { additionalContext, notices } = handleSessionStart(carnet, payload, {
          host: host.id,
          processId: host.processId(io.env),
          RUCHER_PURGE_DAYS: io.env.RUCHER_PURGE_DAYS,
          RUCHER_HOME: io.env.RUCHER_HOME,
          RUCHER_SESSION_ID: io.env.RUCHER_SESSION_ID,
          RUCHER_SESSION_KIND: io.env.RUCHER_SESSION_KIND,
          RUCHER_SESSION_NAME: io.env.RUCHER_SESSION_NAME,
          RUCHER_PROMPT_VERSION: io.env.RUCHER_PROMPT_VERSION,
          RUCHER_MEMORY_MAX_CHARACTERS: io.env.RUCHER_MEMORY_MAX_CHARACTERS,
          RUCHER_MEMORY_HALF_LIFE_DAYS: io.env.RUCHER_MEMORY_HALF_LIFE_DAYS,
        });
        for (const notice of notices) io.stderr(`${notice}\n`);
        if (additionalContext) {
          const hookSpecificOutput = { hookEventName: 'SessionStart', additionalContext };
          io.stdout(`${JSON.stringify({ hookSpecificOutput })}\n`);
        }
      });
    },
    'SessionStart',
  );
}

export function subagentStart(stdinText: string, io: Io): number {
  return runHook(io, () => {
    const payload = host.parseSubagentPayload(stdinText);
    withCarnet(payload, io, (carnet) => {
      carnet.agents.pairSubagent(payload.session_id, payload.agent_id);
    });
    if (host.subagentInheritsContext(payload)) return;
    const hookSpecificOutput = {
      hookEventName: 'SubagentStart',
      additionalContext: SUBAGENT_RULES,
    };
    io.stdout(`${JSON.stringify({ hookSpecificOutput })}\n`);
  });
}

export function subagentStop(stdinText: string, io: Io): number {
  return runHook(io, () => {
    const payload = host.parseSubagentPayload(stdinText);
    withCarnet(payload, io, (carnet) => {
      carnet.agents.stopSubagent(payload.session_id, payload.agent_id, host.subagentNames(payload));
    });
  });
}

export function userPromptSubmit(stdinText: string, io: Io): number {
  return runHook(
    io,
    () => {
      const payload = host.parsePromptPayload(stdinText);
      withCarnet(payload, io, (carnet) => {
        handleUserPromptSubmit(carnet, host, payload);
      });
    },
    'UserPromptSubmit',
  );
}

export function postToolUse(stdinText: string, io: Io): number {
  return runHook(io, () => {
    const payload = host.parseToolPayload(stdinText);
    if (payload.agent_id || !payload.path) return;
    withCarnet(payload, io, (carnet) => {
      const additionalContext = handleToolUse(carnet, payload, {
        RUCHER_MEMORY_MAX_CHARACTERS: io.env.RUCHER_MEMORY_MAX_CHARACTERS,
        RUCHER_MEMORY_HALF_LIFE_DAYS: io.env.RUCHER_MEMORY_HALF_LIFE_DAYS,
      });
      if (!additionalContext) return;
      const hookSpecificOutput = { hookEventName: 'PostToolUse', additionalContext };
      io.stdout(`${JSON.stringify({ hookSpecificOutput })}\n`);
    });
  });
}

export function sessionEnd(stdinText: string, io: Io): number {
  return runHook(io, () => {
    const payload = host.parseSessionEndPayload(stdinText);
    withCarnet(payload, io, (carnet) => {
      handleSessionEnd(carnet, payload);
    });
  });
}
