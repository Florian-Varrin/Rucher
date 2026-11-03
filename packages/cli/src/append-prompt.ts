import type { Group, Session } from '@rucher/carnet';

export interface AppendPromptContext {
  group: Group;
  session: Pick<Session, 'id' | 'name' | 'kind'>;
}

export function appendPromptFile(_context: AppendPromptContext): string | undefined {
  return undefined;
}
