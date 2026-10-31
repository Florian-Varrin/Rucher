import { type Ctx, nowIso } from "./context.ts";
import { CarnetError } from "./errors.ts";
import { type UserActionStatus, isUserActionStatus } from "./status/model.ts";
import { sanitizeNote } from "./status/note.ts";

export interface TableItem {
  session: string;
  text: string;
  status: UserActionStatus | null;
  mainWorking: boolean;
  updatedAt: string;
}

export interface SetTableInput {
  text: string;
  mainWorking: boolean;
  status?: UserActionStatus;
}

interface TableRow {
  session: string;
  text: string;
  status: UserActionStatus | null;
  main_working: number;
  updated_at: string;
}

function toItem(row: TableRow): TableItem {
  return {
    session: row.session,
    text: row.text,
    status: row.status,
    mainWorking: row.main_working === 1,
    updatedAt: row.updated_at,
  };
}

export function getTable(ctx: Ctx, session: string): TableItem | undefined {
  const row = ctx.db.prepare("SELECT * FROM table_items WHERE session = ?").get(session) as
    | TableRow
    | undefined;
  return row && toItem(row);
}

export function setTable(ctx: Ctx, session: string, input: SetTableInput): TableItem {
  if (input.mainWorking && input.status) {
    throw new CarnetError(
      "TABLE_STATUS_WITH_MAIN_WORKING",
      "A user-action status cannot be set while main is working",
    );
  }
  if (input.status !== undefined && !isUserActionStatus(input.status)) {
    throw new CarnetError("INVALID_STATUS", `Invalid table status "${String(input.status)}"`);
  }
  ctx.db
    .prepare(
      `INSERT INTO table_items (session, text, status, main_working, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session) DO UPDATE SET text = excluded.text, status = excluded.status,
         main_working = excluded.main_working, updated_at = excluded.updated_at`,
    )
    .run(
      session,
      sanitizeNote(input.text),
      input.status ?? null,
      input.mainWorking ? 1 : 0,
      nowIso(ctx),
    );
  return getTable(ctx, session) as TableItem;
}

export function clearTable(ctx: Ctx, session: string): void {
  ctx.db.prepare("DELETE FROM table_items WHERE session = ?").run(session);
}
