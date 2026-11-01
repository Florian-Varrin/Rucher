import {
  CarnetError,
  handleSessionStart,
  handleUserPromptSubmit,
  openCarnet,
  parseHookPayload,
  parsePromptPayload,
  parseSubagentPayload,
} from '@rucher/carnet';
import type { Io } from '../io.ts';

export function sessionStart(stdinText: string, io: Io): number {
  try {
    const payload = parseHookPayload(stdinText);
    const carnet = openCarnet({ cwd: payload.cwd ?? io.cwd, env: io.env });
    try {
      const { additionalContext } = handleSessionStart(carnet, payload, {
        CLAUDE_PID: io.env.CLAUDE_PID,
      });
      if (additionalContext) {
        const hookSpecificOutput = { hookEventName: 'SessionStart', additionalContext };
        io.stdout(`${JSON.stringify({ hookSpecificOutput })}\n`);
      }
    } finally {
      carnet.close();
    }
  } catch (error) {
    if (error instanceof CarnetError && error.code === 'NO_GROUP') return 0;
    io.stderr(`rucher hook: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  return 0;
}

type SubagentAction = 'pairSubagent' | 'stopSubagent';

function subagentHook(action: SubagentAction, stdinText: string, io: Io): number {
  try {
    const payload = parseSubagentPayload(stdinText);
    const carnet = openCarnet({ cwd: payload.cwd ?? io.cwd, env: io.env });
    try {
      carnet.agents[action](payload.session_id, payload.agent_id);
    } finally {
      carnet.close();
    }
  } catch (error) {
    if (error instanceof CarnetError && error.code === 'NO_GROUP') return 0;
    io.stderr(`rucher hook: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  return 0;
}

export function subagentStart(stdinText: string, io: Io): number {
  return subagentHook('pairSubagent', stdinText, io);
}

export function subagentStop(stdinText: string, io: Io): number {
  return subagentHook('stopSubagent', stdinText, io);
}

export function userPromptSubmit(stdinText: string, io: Io): number {
  try {
    const payload = parsePromptPayload(stdinText);
    const carnet = openCarnet({ cwd: payload.cwd ?? io.cwd, env: io.env });
    try {
      handleUserPromptSubmit(carnet, payload);
    } finally {
      carnet.close();
    }
  } catch (error) {
    if (error instanceof CarnetError && error.code === 'NO_GROUP') return 0;
    io.stderr(`rucher hook: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  return 0;
}
