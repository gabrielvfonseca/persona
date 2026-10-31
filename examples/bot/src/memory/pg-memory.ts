import type { Embedder, RecallWeights, Turn } from "@persona/core";
import {
  embedOrUndefined,
  fuseWeighted,
  type MemoryNode,
  type MemoryStores,
  type NodeKind,
} from "@persona/memory";
import {
  KNOWLEDGE_CHAT,
  type KVStorage,
  kvDedupeStore,
  kvRateLimiter,
  loadKvBotState,
  type PersistentBotState,
  type PgNode,
  type PgNodeStore,
} from "@persona/postgres";

export interface PgMemoryOptions {
  /** Enables semantic recall. Without it, recall is keyword-only. */
  embedder?: Embedder | undefined;
  /** Pause flag, dedupe keys and rate-limit windows. */
  kv: KVStorage;
  maxPerWindow?: number | undefined;
  /** Turns returned by `history.load`. Older turns stay searchable. */
  maxTurns?: number | undefined;
  /** Chat turns, facts and quotes, with keyword and semantic search. */
  nodes: PgNodeStore;
  rateWindowMs?: number | undefined;
  recallWeights?: Partial<RecallWeights> | undefined;
}

export type PgMemory = MemoryStores & { state: PersistentBotState };

const DEFAULT_RECALL: RecallWeights = {
  keywordWeight: 1,
  rrfK: 60,
  semanticWeight: 1,
};

const DEFAULT_MAX_TURNS = 20;

function toMemoryNode(node: PgNode): MemoryNode {
  return node;
}

/**
 * The bot's memory on Postgres. Same contract as `createMemory`, but every
 * call is async. Turns are stored as `turn` nodes, so recall can find past
 * messages just as the in-memory version does.
 */
export async function createPgMemory(opts: PgMemoryOptions): Promise<PgMemory> {
  const { nodes, embedder } = opts;
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  let recallWeights: RecallWeights = {
    ...DEFAULT_RECALL,
    ...opts.recallWeights,
  };

  async function remember(
    chatId: string,
    text: string,
    kind: NodeKind = "fact"
  ): Promise<MemoryNode> {
    const [vector] = (await embedOrUndefined(embedder, [text])) ?? [];
    return toMemoryNode(
      await nodes.add({ chatId, embedding: vector, kind, text })
    );
  }

  return {
    dedupe: kvDedupeStore(opts.kv),
    history: {
      async append(chatId: string, turns: Turn[]): Promise<void> {
        const vectors = await embedOrUndefined(
          embedder,
          turns.map((t) => t.content)
        );
        for (const [i, t] of turns.entries()) {
          // biome-ignore lint/performance/noAwaitInLoops: rows are inserted in order, so eviction and recency follow the conversation
          await nodes.add({
            chatId,
            embedding: vectors?.[i],
            kind: "turn",
            role: t.role,
            text: t.content,
          });
        }
      },
      async load(chatId: string): Promise<Turn[]> {
        const recent = await nodes.recent(chatId, maxTurns, "turn");
        return recent.map((n) => ({ content: n.text, role: n.role ?? "user" }));
      },
    },
    learn: (text) => remember(KNOWLEDGE_CHAT, text, "fact"),
    rateLimiter: kvRateLimiter(opts.kv, {
      maxPerWindow: opts.maxPerWindow,
      windowMs: opts.rateWindowMs,
    }),
    async recall(chatId, query, limit = 5, weights = recallWeights) {
      const chatIds = [chatId, KNOWLEDGE_CHAT];
      const candidates = Math.max(limit * 3, 10);
      const keyword = await nodes.search(query, { chatIds, limit: candidates });
      const [queryVector] = (await embedOrUndefined(embedder, [query])) ?? [];
      const semantic = queryVector
        ? await nodes.nearest(queryVector, { chatIds, limit: candidates })
        : [];
      const byId = new Map<string, MemoryNode>();
      for (const n of [...keyword, ...semantic]) {
        byId.set(n.id, toMemoryNode(n));
      }
      const ids = fuseWeighted([
        { nodes: keyword, weight: weights.keywordWeight },
        { nodes: semantic, weight: weights.semanticWeight },
      ]);
      return ids
        .slice(0, limit)
        .map((id) => byId.get(id))
        .filter((n): n is MemoryNode => n !== undefined);
    },
    remember,
    setRecallWeights: (w) => {
      recallWeights = { ...recallWeights, ...w };
    },
    state: await loadKvBotState(opts.kv),
  };
}
