import { type Carnet, CarnetError, type Session } from '@rucher/carnet';

export class CliError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export function findSession(carnet: Carnet, reference: string): Session {
  try {
    return carnet.sessions.find(reference);
  } catch (error) {
    if (!(error instanceof CarnetError) || error.code !== 'SESSION_NOT_FOUND') throw error;
    const known = carnet.sessions
      .list()
      .map((session) => session.name)
      .filter(Boolean);
    throw new CliError(
      error.message,
      known.length
        ? `known sessions: ${known.join(', ')}`
        : 'pass a session name, id or id prefix, see rucher sessions --all',
    );
  }
}

export function resolveSession(carnet: Carnet, reference?: string): Session {
  if (reference) return findSession(carnet, reference);
  const session = carnet.sessions.default();
  if (!session)
    throw new CliError(
      'No session in this group yet',
      'start a Claude Code session inside the group',
    );
  return session;
}
