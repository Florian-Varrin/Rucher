import { readRegistry, registerGroup } from "@rucher/carnet";
import { expect, test } from "vite-plus/test";
import { init } from "../src/commands/init.ts";
import { groupsForget, groupsList, groupsPrune } from "../src/commands/groups.ts";
import { makeIo, tempDir } from "./helpers.ts";

function setup() {
  const env = { RUCHER_HOME: tempDir("home-") };
  const shop = tempDir("meta-shop-");
  const blog = tempDir("meta-blog-");
  expect(init({ dir: shop, name: "shop" }, makeIo({ env }))).toBe(0);
  expect(init({ dir: blog, name: "blog" }, makeIo({ env }))).toBe(0);
  registerGroup({ name: "shop", path: "/gone/shop" }, env);
  return { env, shop, blog };
}

test("groups list flags groups whose meta directory is gone, without pruning", () => {
  const { env, shop } = setup();
  const io = makeIo({ env });
  expect(groupsList(io)).toBe(0);
  const lines = io.out.join("").trimEnd().split("\n");
  expect(lines).toHaveLength(3);
  expect(lines.find((l) => l.includes("/gone/shop"))).toMatch(/missing$/);
  expect(lines.find((l) => l.includes(shop))).not.toContain("missing");
  expect(readRegistry(env)).toHaveLength(3);
  expect(groupsList(makeIo({ env: { RUCHER_HOME: tempDir("empty-") } }))).toBe(0);
});

test("groups forget by name refuses ambiguous names, works by path", () => {
  const { env, blog } = setup();
  const ambiguous = makeIo({ env });
  expect(groupsForget("shop", ambiguous)).toBe(1);
  expect(ambiguous.err.join("")).toContain("/gone/shop");
  expect(groupsForget("/gone/shop", makeIo({ env }))).toBe(0);
  expect(groupsForget("blog", makeIo({ env }))).toBe(0);
  expect(readRegistry(env).map((g) => g.name)).toEqual(["shop"]);
  expect(readRegistry(env).some((g) => g.path === blog)).toBe(false);
  const unknown = makeIo({ env });
  expect(groupsForget("nope", unknown)).toBe(1);
  expect(unknown.err.join("")).toContain("no registered group");
});

test("groups prune removes only missing groups", () => {
  const { env } = setup();
  const io = makeIo({ env });
  expect(groupsPrune(io)).toBe(0);
  expect(io.out.join("")).toContain("pruned 1:");
  expect(readRegistry(env).map((g) => g.path)).not.toContain("/gone/shop");
  expect(readRegistry(env)).toHaveLength(2);
  const again = makeIo({ env });
  expect(groupsPrune(again)).toBe(0);
  expect(again.out.join("")).toBe("nothing to prune\n");
});
