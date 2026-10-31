import type { Embedder } from "@persona/core";
import type pg from "pg";
import { toVectorLiteral } from "./db";
import type { KVStorage } from "./kv-stores";

/** `kv` key holding the embedding model whose vectors are stored in `pg_nodes`. */
export const EMBEDDING_MODEL_KEY = "embedding:model";

export interface ReembedOptions {
  /** Nodes embedded per call to the model. */
  batchSize?: number | undefined;
  onProgress?: ((done: number, total: number) => void) | undefined;
}

/**
 * Recomputes the embedding of every node with `embedder`. Walks the nodes in
 * (created_at, id) order in batches, so a restart can start over safely.
 * Returns how many nodes were re-embedded.
 */
export async function reembedNodes(
  pool: pg.Pool,
  embedder: Embedder,
  opts: ReembedOptions = {}
): Promise<number> {
  const batchSize = opts.batchSize ?? 64;
  const { rows: countRows } = await pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM pg_nodes"
  );
  const total = Number(countRows[0]?.n ?? 0);
  let done = 0;
  let afterCreated = -1;
  let afterId = "";
  for (;;) {
    const { rows } = await pool.query<{
      id: string;
      text: string;
      created_at: string;
    }>(
      `SELECT id, text, created_at FROM pg_nodes
        WHERE (created_at, id) > ($1::bigint, $2::text)
        ORDER BY created_at, id
        LIMIT $3`,
      [afterCreated, afterId, batchSize]
    );
    if (rows.length === 0) {
      break;
    }
    const vectors = await embedder.embed(rows.map((r) => r.text));
    await pool.query(
      `UPDATE pg_nodes AS n
          SET embedding = v.vec::vector
         FROM unnest($1::text[], $2::text[]) AS v(id, vec)
        WHERE n.id = v.id`,
      [rows.map((r) => r.id), vectors.map(toVectorLiteral)]
    );
    done += rows.length;
    const last = rows.at(-1);
    if (last) {
      afterCreated = Number(last.created_at);
      afterId = last.id;
    }
    opts.onProgress?.(done, total);
  }
  return done;
}

/**
 * Makes the stored vectors match `model`. If the recorded model differs, or
 * nodes exist with no record (vectors from before this was tracked), every node
 * is re-embedded first. Then the model is recorded. Returns the number re-embedded.
 */
export async function syncEmbeddingModel(opts: {
  pool: pg.Pool;
  kv: KVStorage;
  model: string;
  embedder: Embedder;
  onProgress?: ((done: number, total: number) => void) | undefined;
}): Promise<number> {
  const { pool, kv, model, embedder } = opts;
  const recorded = await kv.get(EMBEDDING_MODEL_KEY);
  let reembedded = 0;
  if (recorded !== model) {
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pg_nodes"
    );
    if (recorded !== null || Number(rows[0]?.n ?? 0) > 0) {
      reembedded = await reembedNodes(pool, embedder, {
        onProgress: opts.onProgress,
      });
    }
    await kv.put(EMBEDDING_MODEL_KEY, model);
  }
  return reembedded;
}
