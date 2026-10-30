import type { BotState, RateLimiter } from "@persona/core";
import type { KVStorage } from "./stores";

const PAUSED_KEY = "bot:paused";

/** Bot state that also reports when its last write has been saved. */
export interface PersistentBotState extends BotState {
  /** Resolves once every `setPaused` call so far is written to KV. */
  flush(): Promise<void>;
}

/**
 * Pause state kept in KV. `paused` is read synchronously, so load it once per
 * request with `loadKvBotState` and call `flush()` before the response ends.
 */
export async function loadKvBotState(
  kv: KVStorage,
  key = PAUSED_KEY,
): Promise<PersistentBotState> {
  let paused = (await kv.get(key)) === "1";
  let pending: Promise<void> = Promise.resolve();
  return {
    get paused() {
      return paused;
    },
    setPaused(v: boolean) {
      paused = v;
      pending = pending.then(() => kv.put(key, v ? "1" : "0"));
    },
    flush: () => pending,
  };
}

export interface KvRateLimiterOptions {
  windowMs?: number | undefined;
  maxPerWindow?: number | undefined;
  now?: (() => number) | undefined;
}

interface Window {
  start: number;
  count: number;
}

/**
 * Fixed-window rate limit kept in KV. Two requests that read the same window at
 * the same moment can both pass, so the limit is approximate under concurrency.
 */
export function kvRateLimiter(
  kv: KVStorage,
  opts: KvRateLimiterOptions = {},
): RateLimiter {
  const windowMs = opts.windowMs ?? 600_000;
  const maxPerWindow = opts.maxPerWindow ?? 5;
  const now = opts.now ?? Date.now;
  return {
    async allow(key: string): Promise<boolean> {
      const k = `rl:${key}`;
      const t = now();
      const raw = await kv.get(k);
      let win: Window = { start: t, count: 0 };
      if (raw) {
        try {
          const prev = JSON.parse(raw) as Window;
          if (t - prev.start < windowMs) win = prev;
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
