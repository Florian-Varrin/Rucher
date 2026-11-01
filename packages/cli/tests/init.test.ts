import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { groupAdd, groupShow } from "../src/commands/group.ts";
import { init } from "../src/commands/init.ts";
import { makeIo, tempDir } from "./helpers.ts";

function setup() {
  const meta = tempDir("meta-");
  const api = tempDir("repo-api-");
  const web = tempDir("repo-web-");
  const env = { RUCHER_HOME: tempDir("home-") };
  return { meta, api, web, env, io: makeIo({ cwd: meta, env }) };
}

function settingsOf(meta: string) {
  return JSON.parse(readFileSync(join(meta, ".claude", "settings.json"), "utf8"));
}

test("init with repos writes the group, the CLAUDE.md template and the settings", () => {
  const { meta, api, web, io } = setup();
  expect(init({ name: "mycity", repos: [api, web] }, io)).toBe(0);
  expect(io.out.join("")).toContain("mycity initialised");
  expect(io.out.join("")).toContain("written .claude/settings.json");
  expect(existsSync(join(meta, ".rucher", "carnet.db"))).toBe(true);
  const claudeMd = readFileSync(join(meta, "CLAUDE.md"), "utf8");
  expect(claudeMd).toContain("# mycity");
  expect(claudeMd).toContain(`: ${api}`);
  expect(settingsOf(meta)).toEqual({ permissions: { additionalDirectories: [api, web] } });
});

test("init without repos writes no settings and points at group add", () => {
  const { meta, io } = setup();
  expect(init({}, io)).toBe(0);
  expect(io.out.join("")).toContain("rucher group add <path>");
  expect(existsSync(join(meta, ".claude", "settings.json"))).toBe(false);
  expect(readFileSync(join(meta, "CLAUDE.md"), "utf8")).toContain("none yet");
});

test("group add refreshes the repos block of a generated CLAUDE.md", () => {
  const { meta, api, web, io, env } = setup();
  expect(init({ repos: [api] }, io)).toBe(0);
  const path = join(meta, "CLAUDE.md");
  writeFileSync(path, `${readFileSync(path, "utf8")}\n## Mine\n\nkeep this\n`);
  const addIo = makeIo({ cwd: meta, env });
  expect(groupAdd(web, addIo)).toBe(0);
  expect(addIo.out.join("")).toContain("updated CLAUDE.md");
  const content = readFileSync(path, "utf8");
  expect(content).toContain(`: ${api}`);
  expect(content).toContain(`: ${web}`);
  expect(content).toContain("## Mine\n\nkeep this");
  expect(content.match(/<!-- rucher:repos start -->/g)).toHaveLength(1);
  expect(groupAdd(web, makeIo({ cwd: meta, env })).valueOf()).toBe(0);
});

test("group add extends group.json and merges into existing settings", () => {
  const { meta, api, web, io, env } = setup();
  writeFileSync(join(meta, "CLAUDE.md"), "mine\n");
  expect(init({ repos: [api] }, io)).toBe(0);
  expect(readFileSync(join(meta, "CLAUDE.md"), "utf8")).toBe("mine\n");
  const settings = settingsOf(meta);
  settings.permissions.allow = ["Bash(ls)"];
  writeFileSync(join(meta, ".claude", "settings.json"), JSON.stringify(settings));

  const addIo = makeIo({ cwd: meta, env });
  expect(groupAdd(web, addIo)).toBe(0);
  expect(addIo.out.join("")).toContain("updated .claude/settings.json");
  expect(addIo.out.join("")).toContain("no rucher:repos markers");
  expect(readFileSync(join(meta, "CLAUDE.md"), "utf8")).toBe("mine\n");
  expect(settingsOf(meta)).toEqual({
    permissions: { additionalDirectories: [api, web], allow: ["Bash(ls)"] },
  });

  const fromRepo = makeIo({ cwd: web, env });
  expect(groupShow(fromRepo)).toBe(0);
  expect(fromRepo.out.join("")).toContain(web);

  const bad = makeIo({ cwd: meta, env });
  expect(groupAdd(join(meta, "missing"), bad)).toBe(1);
  expect(bad.err.join("")).toContain("does not exist");
  expect(init({}, makeIo({ cwd: meta, env }))).toBe(1);
});
