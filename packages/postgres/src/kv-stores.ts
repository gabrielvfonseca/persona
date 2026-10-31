import type { DedupeStore, HistoryStore, Turn } from "@persona/core";

export interface KVStorage {
  delete: (key: string) => Promise<void>;
  get: (key: string) => Promise<string | null>;
  put: (
    key: string,
    value: string,
    opts?: { expirationTtl?: number }
  ) => Promise<void>;
}

function keyFor(chatId: string): string {
  return `chat:${chatId}`;
}

function isTurn(value: unknown): value is Turn {
  return (
    typeof value === "object" &&
    value !== null &&
    "role" in value &&
    (value.role === "user" || value.role === "assistant") &&
    "content" in value &&
    typeof value.content === "string"
  );
}

/** Stored turns, or none when the entry is missing or not a turn list. */
function parseTurns(raw: string | null): Turn[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isTurn) : [];
  } catch {
    return [];
  }
}

/** KV-backed history. Note: KV read-modify-write can race under concurrency. */
export function kvHistoryStore(kv: KVStorage): HistoryStore {
  return {
    append: async (chatId: string, turns: Turn[]) => {
      const existing = parseTurns(await kv.get(keyFor(chatId)));
      await kv.put(
        keyFor(chatId),
        JSON.stringify([...existing, ...turns].slice(-20))
      );
    },
    load: async (chatId: string) => parseTurns(await kv.get(keyFor(chatId))),
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
