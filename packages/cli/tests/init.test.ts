import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { init } from "../src/commands/init.ts";
import { makeIo, tempDir } from "./helpers.ts";

function meta() {
  const root = tempDir("meta-");
  mkdirSync(join(root, "api", ".git"), { recursive: true });
  mkdirSync(join(root, "web", ".git"), { recursive: true });
  return { root, io: makeIo({ cwd: root, env: { RUCHER_HOME: tempDir("home-") } }) };
}

test("creates the group and both templates", () => {
  const { root, io } = meta();
  expect(init({ name: "mycity" }, io)).toBe(0);
  expect(io.out.join("")).toContain("mycity initialised");
  expect(existsSync(join(root, ".rucher", "carnet.db"))).toBe(true);
  const claudeMd = readFileSync(join(root, "CLAUDE.md"), "utf8");
  expect(claudeMd).toContain("# mycity");
  expect(claudeMd).toContain("- `api/`");
  const settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
  expect(settings).toEqual({ permissions: { additionalDirectories: ["./api", "./web"] } });
});

test("an empty folder gets an explicit hint about repos", () => {
  const root = tempDir("meta-");
  const io = makeIo({ cwd: root, env: { RUCHER_HOME: tempDir("home-") } });
  expect(init({}, io)).toBe(0);
  expect(io.out.join("")).toContain("none yet, detected automatically");
  expect(io.out.join("")).toContain("no .claude/settings.json");
  expect(existsSync(join(root, ".claude", "settings.json"))).toBe(false);
  expect(existsSync(join(root, "CLAUDE.md"))).toBe(true);
});

test("keeps existing files, honours --repos and a target dir, refuses a second init", () => {
  const { root, io } = meta();
  writeFileSync(join(root, "CLAUDE.md"), "mine\n");
  expect(init({ dir: ".", repos: ["api"] }, io)).toBe(0);
  expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe("mine\n");
  expect(io.out.join("")).toContain("kept existing CLAUDE.md");
  const settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
  expect(settings.permissions.additionalDirectories).toEqual(["./api"]);
  const again = makeIo({ cwd: root, env: io.env });
  expect(init({}, again)).toBe(1);
  expect(again.err.join("")).toContain("already a Rucher group");
});
