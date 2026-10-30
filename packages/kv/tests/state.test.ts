import { describe, expect, it } from "vitest";
import { kvRateLimiter, loadKvBotState } from "../src/state";

function memoryKv() {
  const data = new Map<string, string>();
  return {
    data,
    kv: {
      get: async (k: string) => data.get(k) ?? null,
      put: async (k: string, v: string) => {
        data.set(k, v);
      },
      delete: async (k: string) => {
        data.delete(k);
      },
    },
  };
}

describe("loadKvBotState", () => {
  it("starts unpaused and persists a pause across loads", async () => {
    const { kv } = memoryKv();
    const first = await loadKvBotState(kv);
    expect(first.paused).toBe(false);
    first.setPaused(true);
    expect(first.paused).toBe(true);
    await first.flush();

    const second = await loadKvBotState(kv);
    expect(second.paused).toBe(true);
    second.setPaused(false);
    await second.flush();
    expect((await loadKvBotState(kv)).paused).toBe(false);
  });
});

describe("kvRateLimiter", () => {
  it("limits per key inside a window and resets after it", async () => {
    const { kv } = memoryKv();
    let now = 0;
    const limiter = kvRateLimiter(kv, {
      maxPerWindow: 2,
      windowMs: 1000,
      now: () => now,
    });
    expect(await limiter.allow("chat-a")).toBe(true);
    expect(await limiter.allow("chat-a")).toBe(true);
    expect(await limiter.allow("chat-a")).toBe(false);
    expect(await limiter.allow("chat-b")).toBe(true);
    now = 1000;
    expect(await limiter.allow("chat-a")).toBe(true);
  });

  it("treats a corrupt entry as a fresh window", async () => {
    const { kv, data } = memoryKv();
    data.set("rl:chat", "not json");
    const limiter = kvRateLimiter(kv, { maxPerWindow: 1 });
    expect(await limiter.allow("chat")).toBe(true);
  });
});
