import type { Carnet } from './carnet.ts';
import { CarnetError } from './errors.ts';
import { EMOJI, OPEN_AGENT_STATUSES } from './status/model.ts';

type OpenAgentStatus = (typeof OPEN_AGENT_STATUSES)[number];

export const AGENT_STEPS = [
  'answered',
  'applying',
  'applied',
  'tested',
  'committed',
  'dropped',
] as const;
export type AgentStep = (typeof AGENT_STEPS)[number];

export interface StepAgentInput {
  name: string;
  step: AgentStep;
  commit?: string | undefined;
  note?: string | undefined;
  next?: OpenAgentStatus | undefined;
}

const DEFAULT_NEXT: Partial<Record<AgentStep, OpenAgentStatus>> = {
  answered: 'apply',
  applied: 'test',
  tested: 'commit',
};

function tableIsAbout(carnet: Carnet, session: string, name: string): boolean {
  const text = carnet.table.get(session)?.text;
  return text?.startsWith(name) === true && !/[\w-]/.test(text.charAt(name.length));
}

function clearTableOf(carnet: Carnet, session: string, name: string): void {
  if (tableIsAbout(carnet, session, name)) carnet.table.clear(session);
}

export function stepAgent(carnet: Carnet, session: string, input: StepAgentInput): string {
  const { name, step, commit, note } = input;
  if (!carnet.agents.get(session, name)) {
    throw new CarnetError('AGENT_NOT_FOUND', `No agent "${name}" in this session`);
  }
  switch (step) {
    case 'applying':
      carnet.table.set(session, { text: `${name} applying`, mainWorking: true });
      return `⚙️ ${name} applying`;
    case 'committed': {
      if (!commit) throw new CarnetError('COMMIT_REQUIRED', 'The committed step needs the commit');
      carnet.events.log(session, { type: 'committed', agent: name, commit, note });
      carnet.agents.drop(session, name, `committed ${commit}`);
      clearTableOf(carnet, session, name);
      return `${EMOJI.commit} ${name} committed ${commit}, closed`;
    }
    case 'dropped':
      carnet.agents.drop(session, name, note);
      clearTableOf(carnet, session, name);
      return `${name} dropped, closed`;
    default: {
      const next = input.next ?? (DEFAULT_NEXT[step] as OpenAgentStatus);
      carnet.events.log(session, { type: step, agent: name, note });
      carnet.agents.update(session, name, { status: next });
      if (next === 'running') clearTableOf(carnet, session, name);
      else if (step !== 'answered') {
        carnet.table.set(session, { text: `${name} ${step}, ${next} next`, status: next });
      }
      return `logged ${step} · ${EMOJI[next]} ${name} ${next}`;
    }
  }
}
