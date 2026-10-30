import type { DedupeStore, HistoryStore, Turn } from "@persona/core";

export interface KVStorage {
  get: (key: string) => Promise<string | null>;
  put: (
    key: string,
    value: string,
    opts?: { expirationTtl?: number },
  ) => Promise<void>;
  delete: (key: string) => Promise<void>;
}

function keyFor(chatId: string): string {
  return `chat:${chatId}`;
}

/** KV-backed history. Note: KV read-modify-write can race under concurrency. */
export function kvHistoryStore(kv: KVStorage): HistoryStore {
  return {
    load: async (chatId: string) => {
      const raw = await kv.get(keyFor(chatId));
      if (!raw) return [];
      try {
        return JSON.parse(raw) as Turn[];
      } catch {
        return [];
      }
    },
    append: async (chatId: string, turns: Turn[]) => {
      const existing = await kv.get(keyFor(chatId));
      let arr: Turn[] = [];
      if (existing) {
        try {
          arr = JSON.parse(existing) as Turn[];
        } catch {}
      }
      await kv.put(
        keyFor(chatId),
        JSON.stringify([...arr, ...turns].slice(-20)),
      );
    },
  };
}

export function kvDedupeStore(kv: KVStorage): DedupeStore {
  return {
    has: async (key: string) => Boolean(await kv.get(`dedupe:${key}`)),
    set: async (key: string, ttl: number) => {
      await kv.put(`dedupe:${key}`, "1", {
        expirationTtl: Math.max(ttl / 1000, 60),
      });
    },
  };
}
