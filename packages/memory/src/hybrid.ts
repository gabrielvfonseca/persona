import { reciprocalRankFusion } from "./fusion";

/** Fuses ranked lists of nodes into a list of node ids, best first. */
export function fuse(lists: readonly (readonly { id: string }[])[]): string[] {
  return reciprocalRankFusion(lists.map((list) => list.map((n) => n.id)));
}
