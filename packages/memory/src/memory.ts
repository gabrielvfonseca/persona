import type {
  BotState,
  DedupeStore,
  Embedder,
  HistoryStore,
  RateLimiter,
} from "@persona/core";
import { MemoryBotState } from "./bot-state";
import { MemoryDedupeStore } from "./dedupe";
import { embedOrUndefined } from "./embed";
import { MemoryHistoryStore } from "./history";
import { fuse } from "./hybrid";
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
}

export function createMemory(opts: MemoryOptions = {}): Memory {
  const { embedder } = opts;
  const nodes = new NodeStore({ maxNodes: opts.maxNodes, now: opts.now });
  const history = new MemoryHistoryStore({
    maxTurns: opts.maxTurns,
    nodes,
    embedder,
  });

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
    async recall(chatId, query, limit = 5) {
      const chatIds = [chatId, KNOWLEDGE_CHAT];
      const candidates = Math.max(limit * 3, 10);
      const keyword = nodes.search(query, { chatIds, limit: candidates });
      const [queryVector] = (await embedOrUndefined(embedder, [query])) ?? [];
      const semantic = queryVector
        ? nodes.nearest(queryVector, { chatIds, limit: candidates })
        : [];
      const ids = fuse([keyword, semantic]);
      return ids
        .slice(0, limit)
        .map((id) => nodes.get(id))
        .filter((n): n is MemoryNode => n !== undefined);
    },
  };
}
