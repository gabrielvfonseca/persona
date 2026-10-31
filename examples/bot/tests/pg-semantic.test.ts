import {
  createPool,
  migrate,
  PgKVStorage,
  PgNodeStore,
  type Pool,
} from "@persona/postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalEmbedder } from "../src/embedder";
import { createPgMemory } from "../src/memory/pg-memory";

// Needs a real Postgres (TEST_DATABASE_URL). Runs the bge-small-en-v1.5 model
// in-process, downloading it on first use.
const DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!DB)("semantic recall on Postgres", () => {
  let pool: Pool;
  const embedder = createLocalEmbedder();

  beforeAll(async () => {
    pool = createPool(DB as string, 4);
    await migrate(pool);
    await pool.query("TRUNCATE pg_edges, pg_nodes, kv");
  });

  afterAll(async () => {
    await embedder.unload();
    await pool?.end();
  });

  it("finds a fact by meaning when the words do not overlap", async () => {
    const memory = await createPgMemory({
      embedder,
      kv: new PgKVStorage(pool),
      nodes: new PgNodeStore(pool),
    });
    await memory.remember(
      "chat-1",
      "Ana adopted a golden retriever named Biscuit"
    );
    await memory.remember("chat-1", "Ana works as a nurse at the night shift");
    await memory.remember("chat-2", "Bruno lives in Lisbon");

    // No shared words with the first fact, so only the semantic ranking can find it.
    const hits = await memory.recall("chat-1", "what pet does she have", 2);
    expect(hits[0]?.text).toContain("golden retriever");
  }, 120_000);
});
