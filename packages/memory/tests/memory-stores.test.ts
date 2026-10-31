import { describe, expect, it } from "vitest";
import {
  FixedWindowRateLimiter,
  MemoryBotState,
  MemoryDedupeStore,
  MemoryHistoryStore,
} from "../src/index";

describe("MemoryHistoryStore", () => {
  it("loads empty array for new chat", async () => {
    const store = new MemoryHistoryStore();
    const turns = await store.load("chat1");
    expect(turns).toEqual([]);
  });

  it("appends and loads turns", async () => {
    const store = new MemoryHistoryStore();
    await store.append("chat1", [{ role: "user", content: "hello" }]);
    await store.append("chat1", [{ role: "assistant", content: "hi" }]);
    const turns = await store.load("chat1");
    expect(turns.length).toBe(2);
    expect(turns[0]?.content).toBe("hello");
    expect(turns[1]?.content).toBe("hi");
  });

  it("maintains separate chats", async () => {
    const store = new MemoryHistoryStore();
    await store.append("chat1", [{ role: "user", content: "hello" }]);
    await store.append("chat2", [{ role: "user", content: "world" }]);
    const turns1 = await store.load("chat1");
    const turns2 = await store.load("chat2");
    expect(turns1[0]?.content).toBe("hello");
    expect(turns2[0]?.content).toBe("world");
  });

  it("limits to max 20 turns", async () => {
    const store = new MemoryHistoryStore();
    const turns = Array.from({ length: 25 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `msg${i}`,
    }));
    await store.append("chat1", turns);
    const loaded = await store.load("chat1");
    expect(loaded.length).toBe(20);
    expect(loaded[0]?.content).toBe("msg5");
  });

  it("returns copy of turns", async () => {
    const store = new MemoryHistoryStore();
    await store.append("chat1", [{ role: "user", content: "hello" }]);
    const turns1 = await store.load("chat1");
    const turns2 = await store.load("chat1");
    expect(turns1).not.toBe(turns2);
  });
});

describe("MemoryDedupeStore", () => {
  it("returns false for unseen keys", async () => {
    const store = new MemoryDedupeStore();
    expect(await store.has("key1")).toBe(false);
  });

  it("returns true for seen keys", async () => {
    const store = new MemoryDedupeStore();
    await store.set("key1", 1000);
    expect(await store.has("key1")).toBe(true);
  });

  it("expires keys after ttl", async () => {
    const store = new MemoryDedupeStore();
    await store.set("key1", 10);
    await new Promise((r) => setTimeout(r, 20));
    expect(await store.has("key1")).toBe(false);
  });

  it("evicts oldest entries when over max", async () => {
    const store = new MemoryDedupeStore(3);
    await store.set("key1", 10000);
    await store.set("key2", 10000);
    await store.set("key3", 10000);
    await store.set("key4", 10000);
    expect(await store.has("key1")).toBe(false);
    expect(await store.has("key4")).toBe(true);
  });
});

describe("FixedWindowRateLimiter", () => {
  it("allows requests within limit", async () => {
    const limiter = new FixedWindowRateLimiter({
      windowMs: 60000,
      maxPerWindow: 5,
    });
    expect(await limiter.allow("chat1")).toBe(true);
    expect(await limiter.allow("chat1")).toBe(true);
    expect(await limiter.allow("chat1")).toBe(true);
    expect(await limiter.allow("chat1")).toBe(true);
    expect(await limiter.allow("chat1")).toBe(true);
  });

  it("blocks requests over limit", async () => {
    const limiter = new FixedWindowRateLimiter({
      windowMs: 60000,
      maxPerWindow: 3,
    });
    await limiter.allow("chat1");
    await limiter.allow("chat1");
    await limiter.allow("chat1");
    expect(await limiter.allow("chat1")).toBe(false);
  });

  it("resets after window expires", async () => {
    let now = 1000;
    const limiter = new FixedWindowRateLimiter({
      windowMs: 1000,
      maxPerWindow: 2,
      now: () => now,
    });
    await limiter.allow("chat1");
    await limiter.allow("chat1");
    expect(await limiter.allow("chat1")).toBe(false);
    now = 2500;
    expect(await limiter.allow("chat1")).toBe(true);
  });

  it("resets on demand", async () => {
    const limiter = new FixedWindowRateLimiter({
      windowMs: 60000,
      maxPerWindow: 1,
    });
    await limiter.allow("chat1");
    expect(await limiter.allow("chat1")).toBe(false);
    limiter.reset("chat1");
    expect(await limiter.allow("chat1")).toBe(true);
  });

  it("uses defaults", async () => {
    const limiter = new FixedWindowRateLimiter();
    for (let i = 0; i < 5; i++) {
      expect(await limiter.allow("chat1")).toBe(true);
    }
    expect(await limiter.allow("chat1")).toBe(false);
  });
});

describe("MemoryBotState", () => {
  it("starts unpaused", () => {
    const state = new MemoryBotState();
    expect(state.paused).toBe(false);
  });

  it("can be paused", () => {
    const state = new MemoryBotState();
    state.setPaused(true);
    expect(state.paused).toBe(true);
  });

  it("can be resumed", () => {
    const state = new MemoryBotState();
    state.setPaused(true);
    state.setPaused(false);
    expect(state.paused).toBe(false);
  });
});
