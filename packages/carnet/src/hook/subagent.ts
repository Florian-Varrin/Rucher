export interface HookSubagentPayload {
  session_id: string;
  agent_id: string;
  agent_type?: string | undefined;
  cwd?: string | undefined;
}

export function parseSubagentPayload(json: string): HookSubagentPayload {
  const data = JSON.parse(json) as Record<string, unknown>;
  if (typeof data.session_id !== 'string' || !data.session_id) {
    throw new TypeError('Hook payload has no session_id');
  }
  if (typeof data.agent_id !== 'string' || !data.agent_id) {
    throw new TypeError('Hook payload has no agent_id');
  }
  return {
    session_id: data.session_id,
    agent_id: data.agent_id,
    agent_type: typeof data.agent_type === 'string' ? data.agent_type : undefined,
    cwd: typeof data.cwd === 'string' ? data.cwd : undefined,
  };
}
