import type { BotState, RateLimiter } from "@persona/core";
import type { KVStorage } from "./kv-stores";

const PAUSED_KEY = "bot:paused";

/** Bot state that also reports when its last write has been saved. */
export interface PersistentBotState extends BotState {
  /** Resolves once every `setPaused` call so far is written to KV. */
  flush: () => Promise<void>;
  /** Re-reads the pause flag from KV, so a change made elsewhere takes effect. Waits for pending writes first. */
  refresh: () => Promise<void>;
}

/**
 * Pause state kept in KV. `paused` is read synchronously, so load it once per
 * request with `loadKvBotState` and call `flush()` before the response ends.
 */
export async function loadKvBotState(
  kv: KVStorage,
  key = PAUSED_KEY
): Promise<PersistentBotState> {
  let paused = (await kv.get(key)) === "1";
  let pending: Promise<void> = Promise.resolve();
  return {
    flush: () => pending,
    get paused() {
      return paused;
    },
    async refresh() {
      await pending;
      paused = (await kv.get(key)) === "1";
    },
    setPaused(v: boolean) {
      paused = v;
      pending = pending.then(() => kv.put(key, v ? "1" : "0"));
    },
  };
}

export interface KvRateLimiterOptions {
  maxPerWindow?: number | undefined;
  now?: (() => number) | undefined;
  windowMs?: number | undefined;
}

interface Window {
  count: number;
  start: number;
}

function isWindow(value: unknown): value is Window {
  return (
    typeof value === "object" &&
    value !== null &&
    "start" in value &&
    typeof value.start === "number" &&
    "count" in value &&
    typeof value.count === "number"
  );
}

/**
 * Fixed-window rate limit kept in KV. Two requests that read the same window at
 * the same moment can both pass, so the limit is approximate under concurrency.
 */
export function kvRateLimiter(
  kv: KVStorage,
  opts: KvRateLimiterOptions = {}
): RateLimiter {
  const windowMs = opts.windowMs ?? 600_000;
  const maxPerWindow = opts.maxPerWindow ?? 5;
  const now = opts.now ?? Date.now;
  return {
    async allow(key: string): Promise<boolean> {
      const k = `rl:${key}`;
      const t = now();
      const raw = await kv.get(k);
      let win: Window = { count: 0, start: t };
      if (raw) {
        try {
          const prev: unknown = JSON.parse(raw);
          if (isWindow(prev) && t - prev.start < windowMs) {
            win = prev;
          }
        } catch {
          // A corrupt entry starts a new window.
        }
      }
      win.count += 1;
      await kv.put(k, JSON.stringify(win), {
        expirationTtl: Math.max(Math.ceil(windowMs / 1000), 60),
      });
      return win.count <= maxPerWindow;
    },
  };
}
