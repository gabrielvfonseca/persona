import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "../src/db";
import { PgNodeStore } from "../src/node-store";
import { freshPool, TEST_DATABASE_URL } from "./helpers";

const WIDTH_HINT = /2 dimensions/u;

describe.skipIf(!TEST_DATABASE_URL)("bulk import", () => {
  let pool: Pool;
  let store: PgNodeStore;

  beforeEach(async () => {
    pool = await freshPool(TEST_DATABASE_URL as string);
    store = new PgNodeStore(pool, { maxNodes: 1000 });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("adds a batch once: a second batch with the same ids adds nothing", async () => {
    const batch = Array.from({ length: 5 }, (_, i) => ({
      chatId: "group:g",
      createdAt: 1000 + i,
      id: `m${i}`,
      kind: "turn" as const,
      text: `msg ${i}`,
    }));
    expect(await store.addMany(batch)).toBe(5);
    expect(await store.addMany(batch)).toBe(0);
    expect(await store.count()).toBe(5);
  });

  it("stores embeddings from a batch and rejects one of the wrong width", async () => {
    const vector = new Array<number>(384).fill(0.5);
    await store.addMany([
      {
        chatId: "c",
        embedding: vector,
        id: "e1",
        kind: "quote",
        text: "com vetor",
      },
    ]);
    const node = await store.get("e1");
    expect(node?.embedding?.length).toBe(384);
    await expect(
      store.addMany([
        {
          chatId: "c",
          embedding: [0.1, 0.2],
          id: "bad",
          kind: "turn",
          text: "x",
        },
      ])
    ).rejects.toThrow(WIDTH_HINT);
  });

  it("links many edges in one statement and updates weights on repeat", async () => {
    await store.addMany([
      { chatId: "c", id: "a", kind: "turn", text: "a" },
      { chatId: "c", id: "b", kind: "turn", text: "b" },
    ]);
    expect(
      await store.linkMany([{ rel: "follows", source: "a", target: "b" }])
    ).toBe(1);
    expect(
      await store.linkMany([
        { rel: "follows", source: "a", target: "b", weight: 3 },
      ])
    ).toBe(1);
    const reached = await store.traverse("a", 1);
    expect(reached.map((r) => r.node.id)).toContain("b");
  });
});
