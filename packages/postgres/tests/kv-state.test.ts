import { describe, expect, it } from "vitest";
import { kvRateLimiter, loadKvBotState } from "../src/kv-state";

function memoryKv() {
  const data = new Map<string, string>();
  return {
    data,
    kv: {
      delete: (k: string) => {
        data.delete(k);
        return Promise.resolve();
      },
      get: (k: string) => Promise.resolve(data.get(k) ?? null),
      put: (k: string, v: string) => {
        data.set(k, v);
        return Promise.resolve();
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

describe("loadKvBotState refresh", () => {
  it("picks up a pause written by another instance", async () => {
    const { kv } = memoryKv();
    const bot = await loadKvBotState(kv);
    const admin = await loadKvBotState(kv);
    expect(bot.paused).toBe(false);
    admin.setPaused(true);
    await admin.flush();
    expect(bot.paused).toBe(false);
    await bot.refresh();
    expect(bot.paused).toBe(true);
  });

  it("waits for its own pending write before re-reading", async () => {
    const { kv } = memoryKv();
    const bot = await loadKvBotState(kv);
    bot.setPaused(true);
    await bot.refresh();
    expect(bot.paused).toBe(true);
  });
});

describe("kvRateLimiter", () => {
  it("limits per key inside a window and resets after it", async () => {
    const { kv } = memoryKv();
    let now = 0;
    const limiter = kvRateLimiter(kv, {
      maxPerWindow: 2,
      now: () => now,
      windowMs: 1000,
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
