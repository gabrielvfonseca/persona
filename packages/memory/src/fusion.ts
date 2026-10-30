/**
 * Reciprocal rank fusion: merges several ranked id lists into one. An id near
 * the top of any list scores well; `k` damps the effect of exact positions.
 */
export function reciprocalRankFusion(
  rankings: readonly (readonly string[])[],
  k = 60,
): string[] {
  return weightedReciprocalRankFusion(
    rankings.map((list) => ({ ids: list, weight: 1 })),
    k,
  );
}

/** A ranked list with a weight. Higher weight pulls the result toward this list. */
export interface WeightedRanking {
  ids: readonly string[];
  weight: number;
}

/**
 * Weighted reciprocal rank fusion. Each list contributes `weight / (k + rank + 1)`
 * instead of the default 1. This lets the learning engine tune keyword vs
 * semantic recall without changing the ranking algorithm.
 */
export function weightedReciprocalRankFusion(
  rankings: readonly WeightedRanking[],
  k = 60,
): string[] {
  const scores = new Map<string, number>();
  for (const { ids, weight } of rankings) {
    ids.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + weight / (k + rank + 1));
    });
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
