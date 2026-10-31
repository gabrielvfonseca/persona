import {
  type Memory,
  type MemoryNode,
  type MemoryStores,
  NodeStore,
} from "@persona/memory";
import { GroupIndex, type RankWeights } from "./group-index";
import type { GroupStore } from "./group-store";

/**
 * A memory whose recall also searches the group index. Chat history and
 * learned facts come from the base memory; group messages come from the index.
 */
export function withGroupRecall(
  base: MemoryStores,
  index: GroupIndex
): MemoryStores {
  return {
    ...base,
    async recall(chatId, query, limit, weights) {
      const fromGroups: MemoryNode[] = index
        .rank(query, { limit })
        .map((hit) => hit.node);
      // Group messages in the base result would bypass the ranking, so drop them.
      const fromBase = (
        await base.recall(chatId, query, limit, weights)
      ).filter((n) => !index.isIndexed(n.id));
      const seen = new Set<string>();
      const merged = [...fromGroups, ...fromBase].filter((node) => {
        if (seen.has(node.id)) {
          return false;
        }
        seen.add(node.id);
        return true;
      });
      return merged.slice(0, limit);
    },
  };
}

/**
 * Builds the group index from every group in `store`, and a memory that recalls
 * from it. Call once at startup.
 */
export async function createGroupMemory(opts: {
  base: MemoryStores & { nodes?: Memory["nodes"] | undefined };
  store: GroupStore;
  weights?: RankWeights | undefined;
}): Promise<{ memory: MemoryStores; index: GroupIndex }> {
  // Postgres-backed memories have no in-memory node index, so the group index gets its own.
  const index = new GroupIndex(
    opts.base.nodes ?? new NodeStore(),
    opts.weights
  );
  const groups = await opts.store.listGroups();
  // Groups are independent, so their records load in parallel; the index is built in order.
  const loaded = await Promise.all(
    groups.map(async (group) => ({
      group,
      records: await opts.store.read(group),
    }))
  );
  for (const { group, records } of loaded) {
    index.add(group, records);
  }
  return { index, memory: withGroupRecall(opts.base, index) };
}
