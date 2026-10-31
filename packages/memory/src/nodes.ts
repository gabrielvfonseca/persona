import type { Turn } from "@persona/core";
import { SearchIndex } from "./search";

export type NodeKind = "turn" | "fact" | "quote";

/** Chat id for knowledge shared by every chat. */
export const KNOWLEDGE_CHAT = "*";

export interface MemoryNode {
  chatId: string;
  createdAt: number;
  /** Present when the node was embedded. */
  embedding?: readonly number[] | undefined;
  id: string;
  kind: NodeKind;
  role?: Turn["role"] | undefined;
  text: string;
}

export type NewNode = Omit<MemoryNode, "id" | "createdAt"> & {
  createdAt?: number | undefined;
};

export interface ScoredNode extends MemoryNode {
  score: number;
}

export interface NodeStoreOptions {
  /** Oldest nodes are evicted past this count. */
  maxNodes?: number | undefined;
  now?: (() => number) | undefined;
}

/** Cosine similarity of two vectors of equal length. 0 when either is all zeros. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Keeps memory nodes in insertion order and indexes them two ways: BM25 over
 * text, and cosine over embeddings when a node has one. Evicting a node
 * removes it from both indexes.
 */
export class NodeStore {
  private readonly byId = new Map<string, MemoryNode>();
  private readonly order: string[] = [];
  private readonly index = new SearchIndex();
  private readonly maxNodes: number;
  private readonly now: () => number;
  private seq = 0;

  constructor(opts: NodeStoreOptions = {}) {
    this.maxNodes = opts.maxNodes ?? 10_000;
    this.now = opts.now ?? Date.now;
  }

  get size(): number {
    return this.byId.size;
  }

  add(input: NewNode): MemoryNode {
    this.seq += 1;
    const node: MemoryNode = {
      ...input,
      createdAt: input.createdAt ?? this.now(),
      id: `${input.chatId}#${this.seq}`,
    };
    this.byId.set(node.id, node);
    this.order.push(node.id);
    this.index.add(node.id, node.chatId, node.text);
    this.evict();
    return node;
  }

  get(id: string): MemoryNode | undefined {
    return this.byId.get(id);
  }

  /** The last `limit` nodes of a chat, oldest first. Knowledge is not included. */
  recent(chatId: string, limit: number, kind?: NodeKind): MemoryNode[] {
    const out: MemoryNode[] = [];
    for (let i = this.order.length - 1; i >= 0 && out.length < limit; i -= 1) {
      const node = this.byId.get(this.order[i] ?? "");
      if (node?.chatId === chatId && (!kind || node.kind === kind)) {
        out.push(node);
      }
    }
    return out.reverse();
  }

  /** Keyword (BM25) matches among `chatIds`, best first. */
  search(
    query: string,
    opts: { chatIds?: readonly string[]; limit?: number } = {}
  ): ScoredNode[] {
    return this.index
      .search(query, opts)
      .map((hit) => {
        const node = this.byId.get(hit.id);
        return node ? { ...node, score: hit.score } : undefined;
      })
      .filter((n): n is ScoredNode => n !== undefined);
  }

  /** Nearest embedded nodes among `chatIds` by cosine similarity, best first. */
  nearest(
    vector: readonly number[],
    opts: { chatIds?: readonly string[]; limit?: number } = {}
  ): ScoredNode[] {
    const limit = opts.limit ?? 5;
    const allowed = opts.chatIds ? new Set(opts.chatIds) : undefined;
    return this.order
      .flatMap((id): ScoredNode[] => {
        const node = this.byId.get(id);
        if (!node?.embedding) {
          return [];
        }
        if (allowed && !allowed.has(node.chatId)) {
          return [];
        }
        return [{ ...node, score: cosine(vector, node.embedding) }];
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private evict(): void {
    const excess = this.byId.size - this.maxNodes;
    if (excess <= 0) {
      return;
    }
    for (const oldest of this.order.splice(0, excess)) {
      this.byId.delete(oldest);
      this.index.remove(oldest);
    }
  }
}
