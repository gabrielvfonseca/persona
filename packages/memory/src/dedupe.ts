import type { DedupeStore } from "@persona/core";

export class MemoryDedupeStore implements DedupeStore {
  private readonly entries = new Map<string, { expiry: number }>();
  private readonly maxEntries: number;

  constructor(maxEntries = 10_000) {
    this.maxEntries = maxEntries;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.entries.entries()) {
      if (v.expiry <= now) this.entries.delete(k);
    }
    if (this.entries.size > this.maxEntries) {
      for (const k of [...this.entries.keys()].slice(
        0,
        this.entries.size - this.maxEntries,
      )) {
        this.entries.delete(k);
      }
    }
  }

  async has(key: string): Promise<boolean> {
    this.sweep();
    return this.entries.has(key);
  }

  async set(key: string, ttlMs: number): Promise<void> {
    this.sweep();
    this.entries.set(key, { expiry: Date.now() + ttlMs });
  }
}
