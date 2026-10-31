import {
  KNOWLEDGE_CHAT,
  type MemoryNode,
  type NodeStore,
} from "@persona/memory";
import type { GroupRecord } from "./group-import";

const PATTERN_1 = /\d/u;

/** How much each signal counts in the final score. Keyword match is required. */
export interface RankWeights {
  /** Recency halves every this many days. */
  halfLifeDays: number;
  keyword: number;
  quality: number;
  recency: number;
  window: number;
}

export const DEFAULT_RANK_WEIGHTS: RankWeights = {
  halfLifeDays: 365,
  keyword: 1,
  quality: 0.3,
  recency: 0.2,
  window: 0.2,
};

export interface RankedHit {
  breakdown: {
    keyword: number;
    quality: number;
    window: number;
    recency: number;
  };
  /** The message before this one in the same conversation, if any. */
  context?: GroupRecord | undefined;
  node: MemoryNode;
  record: GroupRecord;
  score: number;
}

interface Entry {
  nodeId: string;
  /** Text quality in [0, 1], computed once at import. */
  quality: number;
  record: GroupRecord;
  /** Size of the conversation window, normalised to [0, 1]. */
  window: number;
}

const DAY_MS = 86_400_000;

/**
 * Text quality in [0, 1]. Messages of a few words carry little; very long
 * ones get less weight; a question or a concrete number adds a little.
 */
export function qualityScore(text: string): number {
  const len = text.length;
  if (len < 3) {
    return 0;
  }
  const lengthScore = lengthScoreOf(len);
  const question = text.includes("?") ? 0.15 : 0;
  const concrete = PATTERN_1.test(text) ? 0.1 : 0;
  return Math.min(1, lengthScore + question + concrete);
}

/** Longer messages carry more, up to 160 characters; very long ones taper off. */
function lengthScoreOf(len: number): number {
  if (len <= 40) {
    return len / 40;
  }
  if (len <= 160) {
    return 1;
  }
  return Math.max(0.3, 160 / len);
}

/** Conversation size in [0, 1]. A 50-message window counts as fully active. */
export function windowScore(size: number): number {
  return Math.min(1, Math.log2(1 + size) / Math.log2(1 + 50));
}

/**
 * Group messages, indexed for recall. Each message is a node in the shared
 * knowledge scope, so every chat can recall the group. Ranking combines
 * keyword match, text quality, conversation size and recency.
 */
export class GroupIndex {
  private readonly byRecord = new Map<string, Entry>();
  private readonly byNode = new Map<string, Entry>();
  private readonly byWindow = new Map<string, GroupRecord[]>();
  private readonly groups = new Map<string, Set<string>>();
  private readonly nodes: NodeStore;
  private readonly weights: RankWeights;

  constructor(nodes: NodeStore, weights: RankWeights = DEFAULT_RANK_WEIGHTS) {
    this.nodes = nodes;
    this.weights = weights;
  }

  /** True when a node came from the group index (and so is ranked by it). */
  isIndexed(nodeId: string): boolean {
    return this.byNode.has(nodeId);
  }

  /** The ids already indexed for one group. */
  idsOf(group: string): ReadonlySet<string> {
    return this.groups.get(group) ?? new Set();
  }

  /** Indexes records for a group. Returns how many were new. */
  add(group: string, records: readonly GroupRecord[]): number {
    const sizes = new Map<number, number>();
    for (const r of records) {
      sizes.set(r.windowId, (sizes.get(r.windowId) ?? 0) + 1);
    }
    let added = 0;
    const ids = this.groups.get(group) ?? new Set<string>();
    // Skip records already indexed, including repeats within this batch.
    const batch = new Set<string>();
    const fresh = records.filter((record) => {
      if (this.byRecord.has(record.id) || batch.has(record.id)) {
        return false;
      }
      batch.add(record.id);
      return true;
    });
    for (const record of fresh) {
      const node = this.nodes.add({
        chatId: KNOWLEDGE_CHAT,
        createdAt: record.ts,
        kind: "fact",
        text: `${record.sender}: ${record.text}`,
      });
      const entry: Entry = {
        nodeId: node.id,
        quality: qualityScore(record.text),
        record,
        window: windowScore(sizes.get(record.windowId) ?? 1),
      };
      this.byRecord.set(record.id, entry);
      this.byNode.set(node.id, entry);
      ids.add(record.id);
      const key = windowKey(group, record.windowId);
      const list = this.byWindow.get(key) ?? [];
      list.push(record);
      this.byWindow.set(key, list);
      added += 1;
    }
    this.groups.set(group, ids);
    return added;
  }

  /** Forgets a group. Its nodes stay in the store but are never returned again. */
  delete(group: string): void {
    for (const id of this.groups.get(group) ?? []) {
      const entry = this.byRecord.get(id);
      if (entry) {
        this.byNode.delete(entry.nodeId);
        this.byRecord.delete(id);
      }
    }
    this.groups.delete(group);
  }

  summaries(): {
    group: string;
    messages: number;
    first: number;
    last: number;
  }[] {
    return [...this.groups.keys()].sort().map((group) => {
      const records = [...(this.groups.get(group) ?? [])]
        .map((id) => this.byRecord.get(id)?.record)
        .filter((r): r is GroupRecord => r !== undefined);
      const times = records.map((r) => r.ts).filter((t) => t > 0);
      return {
        first: times.length ? Math.min(...times) : 0,
        group,
        last: times.length ? Math.max(...times) : 0,
        messages: records.length,
      };
    });
  }

  /** Ranked matches for a query, best first. Optionally limited to one group. */
  rank(
    query: string,
    opts: { limit?: number; group?: string; now?: number } = {}
  ): RankedHit[] {
    const limit = opts.limit ?? 5;
    const candidates = this.nodes
      .search(query, { chatIds: [KNOWLEDGE_CHAT], limit: 500 })
      .filter((n) => {
        const entry = this.byNode.get(n.id);
        return (
          entry !== undefined &&
          (opts.group === undefined || entry.record.group === opts.group)
        );
      });
    if (candidates.length === 0) {
      return [];
    }

    const maxKeyword = Math.max(...candidates.map((c) => c.score)) || 1;
    const newest = this.newestTimestamp();
    const now = opts.now ?? newest;
    const w = this.weights;

    const hits: RankedHit[] = candidates.map((c) => {
      const entry = this.byNode.get(c.id);
      if (!entry) {
        throw new Error(
          "unreachable: candidates are filtered to indexed nodes"
        );
      }
      const ageDays = Math.max(0, (now - entry.record.ts) / DAY_MS);
      const recency =
        entry.record.ts > 0 ? 0.5 ** (ageDays / w.halfLifeDays) : 0;
      const breakdown = {
        keyword: c.score / maxKeyword,
        quality: entry.quality,
        recency,
        window: entry.window,
      };
      const score =
        w.keyword * breakdown.keyword +
        w.quality * breakdown.quality +
        w.window * breakdown.window +
        w.recency * breakdown.recency;
      return {
        breakdown,
        context: this.previousInWindow(entry.record),
        node: c,
        record: entry.record,
        score,
      };
    });
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private previousInWindow(record: GroupRecord): GroupRecord | undefined {
    const list =
      this.byWindow.get(windowKey(record.group, record.windowId)) ?? [];
    const index = list.findIndex((r) => r.id === record.id);
    return index > 0 ? list[index - 1] : undefined;
  }

  private newestTimestamp(): number {
    let newest = 0;
    for (const entry of this.byRecord.values()) {
      newest = Math.max(newest, entry.record.ts);
    }
    return newest;
  }
}

function windowKey(group: string, windowId: number): string {
  return `${group}\u0000${windowId}`;
}
