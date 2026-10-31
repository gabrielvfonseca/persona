import type {
  BotState,
  DedupeStore,
  Embedder,
  HistoryStore,
  RateLimiter,
  RecallWeights,
} from "@persona/core";
import { MemoryBotState } from "./bot-state";
import { MemoryDedupeStore } from "./dedupe";
import { embedOrUndefined } from "./embed";
import { MemoryHistoryStore } from "./history";
import { fuseWeighted } from "./hybrid";
import {
  KNOWLEDGE_CHAT,
  type MemoryNode,
  type NodeKind,
  NodeStore,
} from "./nodes";
import { FixedWindowRateLimiter } from "./rate-limit";

export interface MemoryOptions {
  /** Enables semantic recall. Without it, recall is keyword-only. */
  embedder?: Embedder | undefined;
  maxNodes?: number | undefined;
  maxPerWindow?: number | undefined;
  maxTurns?: number | undefined;
  now?: (() => number) | undefined;
  rateWindowMs?: number | undefined;
  /** Recall fusion weights, tuned by the learning engine. */
  recallWeights?: RecallWeights | undefined;
}

/** Everything a bot keeps between messages, in one object. */
export interface Memory {
  dedupe: DedupeStore;
  history: HistoryStore;
  /** Adds shared knowledge that every chat can recall. */
  learn: (text: string) => Promise<MemoryNode>;
  nodes: NodeStore;
  rateLimiter: RateLimiter;
  /**
   * Nodes relevant to `query` from one chat and the shared knowledge, best
   * first. Uses keyword and semantic rankings together when an embedder is set.
   */
  recall: (
    chatId: string,
    query: string,
    limit?: number,
    weights?: RecallWeights
  ) => Promise<MemoryNode[]>;
  /** Adds a node to a chat. Use `KNOWLEDGE_CHAT` through `learn` for shared facts. */
  remember: (
    chatId: string,
    text: string,
    kind?: NodeKind
  ) => Promise<MemoryNode>;
  /** Update the fusion weights used by `recall`. */
  setRecallWeights: (w: RecallWeights) => void;
  state: BotState;
}

/**
 * The parts of a memory the bot's pipeline uses. Leaves out `nodes`, the
 * synchronous in-memory node index, so a Postgres-backed memory can satisfy it.
 */
export type MemoryStores = Omit<Memory, "nodes">;

const DEFAULT_RECALL: RecallWeights = {
  keywordWeight: 1,
  rrfK: 60,
  semanticWeight: 1,
};

export function createMemory(opts: MemoryOptions = {}): Memory {
  const { embedder } = opts;
  const nodes = new NodeStore({ maxNodes: opts.maxNodes, now: opts.now });
  const history = new MemoryHistoryStore({
    embedder,
    maxTurns: opts.maxTurns,
    nodes,
  });
  let recallWeights: RecallWeights = {
    ...DEFAULT_RECALL,
    ...opts.recallWeights,
  };

  async function remember(
    chatId: string,
    text: string,
    kind: NodeKind = "fact"
  ) {
    const [vector] = (await embedOrUndefined(embedder, [text])) ?? [];
    return nodes.add({ chatId, embedding: vector, kind, text });
  }

  return {
    dedupe: new MemoryDedupeStore(),
    history,
    learn: (text) => remember(KNOWLEDGE_CHAT, text, "fact"),
    nodes,
    rateLimiter: new FixedWindowRateLimiter({
      maxPerWindow: opts.maxPerWindow,
      now: opts.now,
      windowMs: opts.rateWindowMs,
    }),
    async recall(chatId, query, limit = 5, weights = recallWeights) {
      const chatIds = [chatId, KNOWLEDGE_CHAT];
      const candidates = Math.max(limit * 3, 10);
      const keyword = nodes.search(query, { chatIds, limit: candidates });
      const [queryVector] = (await embedOrUndefined(embedder, [query])) ?? [];
      const semantic = queryVector
        ? nodes.nearest(queryVector, { chatIds, limit: candidates })
        : [];
      const ids = fuseWeighted([
        { nodes: keyword, weight: weights.keywordWeight },
        { nodes: semantic, weight: weights.semanticWeight },
      ]);
      return ids
        .slice(0, limit)
        .map((id) => nodes.get(id))
        .filter((n): n is MemoryNode => n !== undefined);
    },
    remember,
    setRecallWeights: (w) => {
      recallWeights = { ...recallWeights, ...w };
    },
    state: new MemoryBotState(),
  };
}
