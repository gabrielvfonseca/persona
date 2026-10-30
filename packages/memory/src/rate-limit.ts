import type { RateLimiter } from "@persona/core";

export interface FixedWindowLimiterOptions {
  windowMs?: number | undefined;
  maxPerWindow?: number | undefined;
  now?: (() => number) | undefined;
}

interface Window {
  start: number;
  count: number;
}

/** Fixed-window limiter with an independent window per key. */
export class FixedWindowRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly windowMs: number;
  private readonly maxPerWindow: number;
  private readonly now: () => number;

  constructor(opts: FixedWindowLimiterOptions = {}) {
    this.windowMs = opts.windowMs ?? 600_000;
    this.maxPerWindow = opts.maxPerWindow ?? 5;
    this.now = opts.now ?? Date.now;
  }

  async allow(key: string): Promise<boolean> {
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || t - w.start >= this.windowMs) {
      w = { start: t, count: 0 };
      this.windows.set(key, w);
    }
    w.count += 1;
    return w.count <= this.maxPerWindow;
  }

  reset(key: string): void {
    this.windows.delete(key);
  }
}
