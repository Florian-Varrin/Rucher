import type { DatabaseSync } from 'node:sqlite';

export interface Ctx {
  db: DatabaseSync;
  now: () => Date;
  // null: sessions without a workspace, which hold no notes.
  workspace: string | null;
}

export function nowIso(ctx: Ctx): string {
  return ctx.now().toISOString();
}
