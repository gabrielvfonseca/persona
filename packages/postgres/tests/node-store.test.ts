import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "../src/db";
import { PgNodeStore } from "../src/node-store";
import { freshPool, TEST_DATABASE_URL } from "./helpers";

/** A unit vector along one axis, padded to the 384-dim column. */
function axis(i: number): number[] {
  const v = new Array<number>(384).fill(0);
  v[i] = 1;
  return v;
}

describe.skipIf(!TEST_DATABASE_URL)("PgNodeStore", () => {
  let pool: Pool;
  let store: PgNodeStore;
  let clock: number;
  /** Each call returns the next tick, so every node gets a distinct time. */
  const nextClock = (): number => {
    const now = clock;
    clock += 1;
    return now;
  };

  beforeEach(async () => {
    pool = await freshPool(TEST_DATABASE_URL as string);
    clock = 1000;
    store = new PgNodeStore(pool, { now: nextClock });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("adds and gets a node, keeping its role and embedding", async () => {
    const added = await store.add({
      chatId: "c1",
      embedding: axis(0),
      kind: "turn",
      role: "user",
      text: "hola amigo",
    });
    const got = await store.get(added.id);
    expect(got?.text).toBe("hola amigo");
    expect(got?.role).toBe("user");
    expect(got?.embedding?.[0]).toBe(1);
    expect(got?.embedding).toHaveLength(384);
  });

  it("returns recent nodes of one chat, oldest first", async () => {
    await store.add({ chatId: "c1", kind: "turn", role: "user", text: "one" });
    await store.add({
      chatId: "c2",
      kind: "turn",
      role: "user",
      text: "other",
    });
    await store.add({
      chatId: "c1",
      kind: "turn",
      role: "assistant",
      text: "two",
    });
    await store.add({ chatId: "c1", kind: "fact", text: "three" });
    const turns = await store.recent("c1", 10, "turn");
    expect(turns.map((n) => n.text)).toEqual(["one", "two"]);
    const last = await store.recent("c1", 1);
    expect(last.map((n) => n.text)).toEqual(["three"]);
  });

  it("finds keyword matches, restricted to the given chats", async () => {
    await store.add({
      chatId: "c1",
      kind: "fact",
      text: "Ana likes green tea",
    });
    await store.add({ chatId: "c2", kind: "fact", text: "Ana prefers coffee" });
    await store.add({ chatId: "*", kind: "fact", text: "Tea is served hot" });
    const hits = await store.search("tea", { chatIds: ["c1", "*"] });
    expect(hits.map((n) => n.chatId).sort()).toEqual(["*", "c1"]);
    const any = await store.search("ana coffee");
    expect(any.map((n) => n.text)).toContain("Ana prefers coffee");
  });

  it("returns nothing for a query with no words", async () => {
    await store.add({ chatId: "c1", kind: "fact", text: "hello" });
    expect(await store.search("!!! ???")).toEqual([]);
  });

  it("ranks nearest embeddings by cosine similarity", async () => {
    await store.add({
      chatId: "c1",
      embedding: axis(0),
      kind: "fact",
      text: "north",
    });
    await store.add({
      chatId: "c1",
      embedding: axis(1),
      kind: "fact",
      text: "east",
    });
    await store.add({
      chatId: "c2",
      embedding: axis(0),
      kind: "fact",
      text: "other chat",
    });
    const hits = await store.nearest(axis(0), { chatIds: ["c1"], limit: 5 });
    expect(hits.map((n) => n.text)).toEqual(["north", "east"]);
    expect(hits[0]?.score).toBeCloseTo(1, 5);
    expect(hits[1]?.score).toBeCloseTo(0, 5);
  });

  it("evicts the oldest nodes past maxNodes", async () => {
    const small = new PgNodeStore(pool, { maxNodes: 3, now: nextClock });
    for (const text of ["a", "b", "c", "d", "e"]) {
      // biome-ignore lint/performance/noAwaitInLoops: nodes are added in order, so eviction removes the oldest
      await small.add({ chatId: "c1", kind: "fact", text });
    }
    expect(await small.count()).toBe(3);
    const kept = await small.recent("c1", 10);
    expect(kept.map((n) => n.text)).toEqual(["c", "d", "e"]);
  });

  it("traverses edges with a recursive walk, reporting shortest depth", async () => {
    const a = await store.add({ chatId: "c1", kind: "fact", text: "a" });
    const b = await store.add({ chatId: "c1", kind: "fact", text: "b" });
    const c = await store.add({ chatId: "c1", kind: "fact", text: "c" });
    const d = await store.add({ chatId: "c1", kind: "fact", text: "d" });
    await store.link(a.id, b.id, "related");
    await store.link(b.id, c.id, "related");
    await store.link(a.id, c.id, "related");
    await store.link(c.id, a.id, "related"); // a cycle must not loop forever
    const reached = await store.traverse(a.id, 5);
    expect(reached.map((r) => [r.node.text, r.depth])).toEqual([
      ["b", 1],
      ["c", 1],
    ]);
    expect(reached.map((r) => r.node.id)).not.toContain(d.id);
    const two = await store.traverse(a.id, 0);
    expect(two).toEqual([]);
  });

  it("updates the weight when the same edge is linked again", async () => {
    const a = await store.add({ chatId: "c1", kind: "fact", text: "a" });
    const b = await store.add({ chatId: "c1", kind: "fact", text: "b" });
    await store.link(a.id, b.id, "related", 1);
    await store.link(a.id, b.id, "related", 0.5);
    const { rows } = await pool.query<{ n: string; w: number }>(
      "SELECT count(*)::text AS n, max(weight) AS w FROM pg_edges"
    );
    expect(rows[0]?.n).toBe("1");
    expect(Number(rows[0]?.w)).toBeCloseTo(0.5, 5);
  });
});
