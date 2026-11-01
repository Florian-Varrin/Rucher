import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Carnet, MEMORY_DB, openDatabase } from "../src/index.ts";

export function tempDir(prefix = "carnet-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function makeClock(start = "2026-10-31T15:41:00.000Z"): () => Date {
  let t = Date.parse(start);
  return () => new Date((t += 1000));
}

export function makeCarnet(): { carnet: Carnet; root: string } {
  const root = tempDir();
  mkdirSync(join(root, "api"));
  const group = { root, name: "test-group", repos: [join(root, "api")], dbPath: MEMORY_DB };
  return { carnet: new Carnet(group, openDatabase(MEMORY_DB), { now: makeClock() }), root };
}

export const SESSION = "0360889d-99c7-4c8f-8447-50ce30696e5a";

export function withSession(): { carnet: Carnet; root: string } {
  const made = makeCarnet();
  made.carnet.sessions.upsertFromHook({ session_id: SESSION, cwd: made.root, source: "startup" });
  return made;
}
