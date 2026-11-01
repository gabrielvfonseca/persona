import type { Embedder } from "@persona/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "../src/db";
import { PgNodeStore } from "../src/node-store";
import {
  EMBEDDING_MODEL_KEY,
  reembedNodes,
  syncEmbeddingModel,
} from "../src/reembed";
import { PgKVStorage } from "../src/storage";
import { freshPool, TEST_DATABASE_URL } from "./helpers";

/** Gives every text the same vector, filled with `value`, so the result is easy to read back. */
function constantEmbedder(value: number): Embedder & { calls: number } {
  const e = {
    calls: 0,
    embed(texts: readonly string[]) {
      e.calls += texts.length;
      return Promise.resolve(
        texts.map(() => new Array<number>(384).fill(value))
      );
    },
  };
  return e;
}

async function firstComponents(pool: Pool): Promise<number[]> {
  const { rows } = await pool.query<{ v: string }>(
    "SELECT embedding::text AS v FROM pg_nodes ORDER BY created_at, id"
  );
  return rows.map((r) => Number((r.v as string).slice(1).split(",")[0]));
}

describe.skipIf(!TEST_DATABASE_URL)("re-embedding", () => {
  let pool: Pool;
  let nodes: PgNodeStore;
  let kv: PgKVStorage;

  beforeEach(async () => {
    pool = await freshPool(TEST_DATABASE_URL as string);
    nodes = new PgNodeStore(pool, {
      now: (() => {
        let t = 1;
        return () => {
          const v = t;
          t += 1;
          return v;
        };
      })(),
    });
    kv = new PgKVStorage(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("replaces every node's embedding in order, across batches", async () => {
    for (const text of ["a", "b", "c", "d", "e"]) {
      // biome-ignore lint/performance/noAwaitInLoops: inserts run in order so ids and timestamps are predictable
      await nodes.add({
        chatId: "c1",
        embedding: new Array(384).fill(0),
        kind: "fact",
        text,
      });
    }
    const done = await reembedNodes(pool, constantEmbedder(0.5), {
      batchSize: 2,
    });
    expect(done).toBe(5);
    expect(await firstComponents(pool)).toEqual([0.5, 0.5, 0.5, 0.5, 0.5]);
  });

  it("embeds nodes that never had a vector", async () => {
    await nodes.add({ chatId: "c1", kind: "fact", text: "no vector yet" });
    await reembedNodes(pool, constantEmbedder(0.25));
    expect(await firstComponents(pool)).toEqual([0.25]);
  });

  it("re-embeds on first sync when nodes exist but no model is recorded", async () => {
    await nodes.add({
      chatId: "c1",
      embedding: new Array(384).fill(9),
      kind: "fact",
      text: "old vector",
    });
    const done = await syncEmbeddingModel({
      embedder: constantEmbedder(1),
      kv,
      model: "bge-small-en-v1.5",
      pool,
    });
    expect(done).toBe(1);
    expect(await kv.get(EMBEDDING_MODEL_KEY)).toBe("bge-small-en-v1.5");
    expect(await firstComponents(pool)).toEqual([1]);
  });

  it("does nothing when the recorded model matches", async () => {
    await nodes.add({
      chatId: "c1",
      embedding: new Array(384).fill(9),
      kind: "fact",
      text: "x",
    });
    await kv.put(EMBEDDING_MODEL_KEY, "bge-small-en-v1.5");
    const embedder = constantEmbedder(1);
    expect(
      await syncEmbeddingModel({
        embedder,
        kv,
        model: "bge-small-en-v1.5",
        pool,
      })
    ).toBe(0);
    expect(embedder.calls).toBe(0);
    expect(await firstComponents(pool)).toEqual([9]);
  });

  it("re-embeds when the model changes", async () => {
    await nodes.add({
      chatId: "c1",
      embedding: new Array(384).fill(9),
      kind: "fact",
      text: "x",
    });
    await kv.put(EMBEDDING_MODEL_KEY, "all-minilm");
    expect(
      await syncEmbeddingModel({
        embedder: constantEmbedder(2),
        kv,
        model: "bge-small-en-v1.5",
        pool,
      })
    ).toBe(1);
    expect(await kv.get(EMBEDDING_MODEL_KEY)).toBe("bge-small-en-v1.5");
  });

  it("only records the model on an empty database", async () => {
    const embedder = constantEmbedder(1);
    expect(
      await syncEmbeddingModel({
        embedder,
        kv,
        model: "bge-small-en-v1.5",
        pool,
      })
    ).toBe(0);
    expect(embedder.calls).toBe(0);
    expect(await kv.get(EMBEDDING_MODEL_KEY)).toBe("bge-small-en-v1.5");
  });
});
