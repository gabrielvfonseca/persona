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
  maxTurns?: number | undefined;
  maxNodes?: number | undefined;
  rateWindowMs?: number | undefined;
  maxPerWindow?: number | undefined;
  /** Enables semantic recall. Without it, recall is keyword-only. */
  embedder?: Embedder | undefined;
  now?: (() => number) | undefined;
  /** Recall fusion weights, tuned by the learning engine. */
  recallWeights?: RecallWeights | undefined;
}

/** Everything a bot keeps between messages, in one object. */
export interface Memory {
  nodes: NodeStore;
  history: HistoryStore;
  dedupe: DedupeStore;
  rateLimiter: RateLimiter;
  state: BotState;
  /** Adds a node to a chat. Use `KNOWLEDGE_CHAT` through `learn` for shared facts. */
  remember(chatId: string, text: string, kind?: NodeKind): Promise<MemoryNode>;
  /** Adds shared knowledge that every chat can recall. */
  learn(text: string): Promise<MemoryNode>;
  /**
   * Nodes relevant to `query` from one chat and the shared knowledge, best
   * first. Uses keyword and semantic rankings together when an embedder is set.
   */
  recall(chatId: string, query: string, limit?: number): Promise<MemoryNode[]>;
  /** Update the fusion weights used by `recall`. */
  setRecallWeights(w: RecallWeights): void;
}

const DEFAULT_RECALL: RecallWeights = {
  keywordWeight: 1,
  semanticWeight: 1,
  rrfK: 60,
};

export function createMemory(opts: MemoryOptions = {}): Memory {
  const { embedder } = opts;
  const nodes = new NodeStore({ maxNodes: opts.maxNodes, now: opts.now });
  const history = new MemoryHistoryStore({
    maxTurns: opts.maxTurns,
    nodes,
    embedder,
  });
  let recallWeights: RecallWeights = {
    ...DEFAULT_RECALL,
    ...opts.recallWeights,
  };

  async function remember(
    chatId: string,
    text: string,
    kind: NodeKind = "fact",
  ) {
    const [vector] = (await embedOrUndefined(embedder, [text])) ?? [];
    return nodes.add({ chatId, kind, text, embedding: vector });
  }

  return {
    nodes,
    history,
    dedupe: new MemoryDedupeStore(),
    rateLimiter: new FixedWindowRateLimiter({
      windowMs: opts.rateWindowMs,
      maxPerWindow: opts.maxPerWindow,
      now: opts.now,
    }),
    state: new MemoryBotState(),
    remember,
    learn: (text) => remember(KNOWLEDGE_CHAT, text, "fact"),
    setRecallWeights: (w) => {
      recallWeights = { ...recallWeights, ...w };
    },
    async recall(chatId, query, limit = 5) {
      const chatIds = [chatId, KNOWLEDGE_CHAT];
      const candidates = Math.max(limit * 3, 10);
      const keyword = nodes.search(query, { chatIds, limit: candidates });
      const [queryVector] = (await embedOrUndefined(embedder, [query])) ?? [];
      const semantic = queryVector
        ? nodes.nearest(queryVector, { chatIds, limit: candidates })
        : [];
      const ids = fuseWeighted([
        { nodes: keyword, weight: recallWeights.keywordWeight },
        { nodes: semantic, weight: recallWeights.semanticWeight },
      ]);
      return ids
        .slice(0, limit)
        .map((id) => nodes.get(id))
        .filter((n): n is MemoryNode => n !== undefined);
    },
  };
}
