import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { MEMORY_DB, migrations, openDatabase, schemaVersion } from "../src/index.ts";
import { tempDir } from "./helpers.ts";

test("migrates an in-memory database to the latest version", () => {
  const db = openDatabase(MEMORY_DB);
  expect(schemaVersion(db)).toBe(migrations.length);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as unknown as { name: string }[];
  expect(tables.map((t) => t.name)).toEqual(["agents", "events", "sessions", "table_items"]);
  db.close();
});

test("opens a file database in WAL mode and is idempotent", () => {
  const path = join(tempDir(), "carnet.db");
  const first = openDatabase(path);
  const mode = first.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
  expect(mode.journal_mode).toBe("wal");
  first.close();
  const second = openDatabase(path);
  expect(schemaVersion(second)).toBe(migrations.length);
  second.close();
});
