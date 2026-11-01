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

test("upgrades a version 1 database and keeps its rows", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const path = join(tempDir(), "carnet.db");
  const old = new DatabaseSync(path);
  old.exec(migrations[0]);
  old.exec("PRAGMA user_version = 1");
  old.exec(
    `INSERT INTO sessions (id, created_at, last_active_at) VALUES ('s', 'x', 'x');
     INSERT INTO agents (session, name, status, started_at, updated_at) VALUES ('s', 'a', 'running', 'x', 'x');`,
  );
  old.close();
  const db = openDatabase(path);
  expect(schemaVersion(db)).toBe(migrations.length);
  expect(db.prepare("SELECT name, claude_agent_id FROM agents").all()).toEqual([
    { name: "a", claude_agent_id: null },
  ]);
  db.close();
});

test("upgrades a version 2 database: existing sessions get no hooked_at", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const path = join(tempDir(), "carnet.db");
  const old = new DatabaseSync(path);
  old.exec(migrations[0]);
  old.exec(migrations[1]);
  old.exec("PRAGMA user_version = 2");
  old.exec(
    "INSERT INTO sessions (id, claude_pid, created_at, last_active_at) VALUES ('s', 7, 'x', 'x')",
  );
  old.close();
  const db = openDatabase(path);
  expect(schemaVersion(db)).toBe(migrations.length);
  expect(db.prepare("SELECT id, claude_pid, hooked_at FROM sessions").all()).toEqual([
    { id: "s", claude_pid: 7, hooked_at: null },
  ]);
  db.close();
});
