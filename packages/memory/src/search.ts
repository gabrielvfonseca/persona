const TOKEN = /[\p{L}\p{N}]+/gu;
const K1 = 1.2;
const B = 0.75;

/** Lowercased letter and digit runs. Unicode-aware, so accents survive. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(TOKEN) ?? [];
}

interface Doc {
  chatId: string;
  length: number;
  terms: Map<string, number>;
}

export interface SearchOptions {
  /** Only documents whose chat is in this list. Omit to search everything. */
  chatIds?: readonly string[] | undefined;
  limit?: number | undefined;
}

export interface SearchHit {
  id: string;
  score: number;
}

/** In-memory BM25 index over text documents, keyed by id. */
export class SearchIndex {
  private readonly docs = new Map<string, Doc>();
  private readonly postings = new Map<string, Set<string>>();
  private totalLength = 0;

  get size(): number {
    return this.docs.size;
  }

  add(id: string, chatId: string, text: string): void {
    this.remove(id);
    const terms = new Map<string, number>();
    const tokens = tokenize(text);
    for (const t of tokens) terms.set(t, (terms.get(t) ?? 0) + 1);
    this.docs.set(id, { chatId, length: tokens.length, terms });
    this.totalLength += tokens.length;
    for (const t of terms.keys()) {
      let ids = this.postings.get(t);
      if (!ids) {
        ids = new Set();
        this.postings.set(t, ids);
      }
      ids.add(id);
    }
  }

  remove(id: string): void {
    const doc = this.docs.get(id);
    if (!doc) return;
    this.docs.delete(id);
    this.totalLength -= doc.length;
    for (const t of doc.terms.keys()) {
      const ids = this.postings.get(t);
      ids?.delete(id);
      if (ids?.size === 0) this.postings.delete(t);
    }
  }

  search(query: string, opts: SearchOptions = {}): SearchHit[] {
    const limit = opts.limit ?? 5;
    const queryTerms = [...new Set(tokenize(query))];
    if (queryTerms.length === 0 || this.docs.size === 0) return [];

    const n = this.docs.size;
    const avgLength = this.totalLength / n || 1;
    const scores = new Map<string, number>();

    for (const term of queryTerms) {
      const ids = this.postings.get(term);
      if (!ids) continue;
      const df = ids.size;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      for (const id of ids) {
        const doc = this.docs.get(id);
        if (!doc) continue;
        if (opts.chatIds && !opts.chatIds.includes(doc.chatId)) continue;
        const tf = doc.terms.get(term) ?? 0;
        const norm =
          (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.length) / avgLength));
        scores.set(id, (scores.get(id) ?? 0) + idf * norm);
      }
    }

    return [...scores.entries()]
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
