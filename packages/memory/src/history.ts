import type { Embedder, HistoryStore, Turn } from "@persona/core";
import { embedOrUndefined } from "./embed";
import { NodeStore } from "./nodes";

export const DEFAULT_MAX_TURNS = 20;

export interface MemoryHistoryOptions {
  /** When set, each appended turn is embedded for semantic recall. */
  embedder?: Embedder | undefined;
  /** Turns returned by `load`. Older turns stay searchable in the node store. */
  maxTurns?: number | undefined;
  nodes?: NodeStore | undefined;
}

/** A `HistoryStore` backed by turn nodes. */
export class MemoryHistoryStore implements HistoryStore {
  readonly nodes: NodeStore;
  private readonly maxTurns: number;
  private readonly embedder: Embedder | undefined;

  constructor(opts: MemoryHistoryOptions = {}) {
    this.maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
    this.nodes = opts.nodes ?? new NodeStore();
    this.embedder = opts.embedder;
  }

  load(chatId: string): Promise<Turn[]> {
    return Promise.resolve(
      this.nodes
        .recent(chatId, this.maxTurns, "turn")
        .map((n) => ({ content: n.text, role: n.role ?? "user" }))
    );
  }

  async append(chatId: string, turns: Turn[]): Promise<void> {
    const vectors = await embedOrUndefined(
      this.embedder,
      turns.map((t) => t.content)
    );
    turns.forEach((t, i) => {
      this.nodes.add({
        chatId,
        embedding: vectors?.[i],
        kind: "turn",
        role: t.role,
        text: t.content,
      });
    });
  }
}
