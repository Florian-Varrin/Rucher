import type { DatabaseSync } from 'node:sqlite';

export interface Ctx {
  db: DatabaseSync;
  now: () => Date;
}

export function nowIso(ctx: Ctx): string {
  return ctx.now().toISOString();
}
