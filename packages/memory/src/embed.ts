import type { Embedder } from "@persona/core";

/**
 * Embeds texts, or returns undefined when there is no embedder or it fails.
 * A failed embedding must not stop a reply, so search falls back to keywords.
 */
export async function embedOrUndefined(
  embedder: Embedder | undefined,
  texts: readonly string[],
): Promise<number[][] | undefined> {
  if (!embedder || texts.length === 0) return undefined;
  try {
    const vectors = await embedder.embed(texts);
    return vectors.length === texts.length ? vectors : undefined;
  } catch {
    return undefined;
  }
}
