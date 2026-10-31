import { weightedReciprocalRankFusion } from "./fusion";

/** A ranked list of nodes with a weight. */
export interface WeightedNodes {
  nodes: readonly { id: string }[];
  weight: number;
}

/** Fuses ranked lists of nodes into a list of node ids, best first. */
export function fuse(lists: readonly (readonly { id: string }[])[]): string[] {
  return weightedReciprocalRankFusion(
    lists.map((list) => ({ ids: list.map((n) => n.id), weight: 1 })),
  );
}

/** Fuses weighted ranked lists of nodes into a list of node ids, best first. */
export function fuseWeighted(lists: readonly WeightedNodes[]): string[] {
  return weightedReciprocalRankFusion(
    lists.map((l) => ({ ids: l.nodes.map((n) => n.id), weight: l.weight })),
  );
}
