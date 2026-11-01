import type { Carnet, Session } from '@rucher/carnet';

export class CliError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export function resolveSession(carnet: Carnet, reference?: string): Session {
  if (reference) {
    const session = carnet.sessions.get(reference) ?? carnet.sessions.byName(reference);
    if (session) return session;
    const known = carnet.sessions
      .list()
      .map((known) => known.name)
      .filter(Boolean);
    throw new CliError(
      `Unknown session "${reference}"`,
      known.length ? `known sessions: ${known.join(', ')}` : 'no named session in this group yet',
    );
  }
  const session = carnet.sessions.default();
  if (!session) throw new CliError('No session in this group yet', 'start claude inside the group');
  return session;
}
