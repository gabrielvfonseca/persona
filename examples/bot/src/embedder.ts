import type { Embedder } from "@persona/core";
import { createGgmlNode, type GgmlNode, type ModelId } from "ggml-node";
import { isGgufPath } from "./model";

/** Width of the `pg_nodes.embedding` column. Changing it needs a new migration. */
export const EMBEDDING_DIMENSION = 384;

/** The embedding model the bot ships with. Its vectors are stored with this id, so a model change triggers a re-embed. */
export const DEFAULT_EMBEDDING_MODEL = "bge-small-en-v1.5";

export interface LocalEmbedder extends Embedder {
  /** Model id, recorded next to the stored vectors. */
  readonly model: string;
  /** Frees the model's memory. The next call reloads it. */
  unload: () => Promise<void>;
}

/**
 * Embeds text in-process with ggml-node. Loads on the first call and downloads
 * the model once if it is not cached. Fails if the model does not produce
 * vectors of `EMBEDDING_DIMENSION`, so the column is never written with them.
 */
export function createLocalEmbedder(
  opts: { model?: string | undefined; cacheDir?: string | undefined } = {}
): LocalEmbedder {
  const model = opts.model ?? DEFAULT_EMBEDDING_MODEL;
  const ai: GgmlNode = createGgmlNode({
    // A registry id, or a path to a GGUF embedding model.
    model: isGgufPath(model) ? { path: model } : (model as ModelId),
    ...(opts.cacheDir ? { cacheDir: opts.cacheDir } : {}),
  });
  return {
    async embed(texts) {
      if (texts.length === 0) {
        return [];
      }
      const { embeddings, dimensions } = await ai.embed({ input: [...texts] });
      if (dimensions !== EMBEDDING_DIMENSION) {
        throw new Error(
          `embedding model ${model} produces ${dimensions} dimensions, expected ${EMBEDDING_DIMENSION}`
        );
      }
      return embeddings;
    },
    model,
    unload: () => ai.unload(),
  };
}
