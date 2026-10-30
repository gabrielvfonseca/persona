import { describe, expect, it } from "vitest";
import {
  createMemory,
  FixedWindowRateLimiter,
  MemoryHistoryStore,
  NodeStore,
  SearchIndex,
  tokenize,
} from "../src/index";

describe("tokenize", () => {
  it("lowercases and keeps accented letters", () => {
    expect(tokenize("Amanhã, eu te falo!")).toEqual([
      "amanhã",
      "eu",
      "te",
      "falo",
    ]);
  });
});

describe("SearchIndex", () => {
  it("ranks documents by how well they match the query", () => {
    const idx = new SearchIndex();
    idx.add("a", "c1", "pizza on friday night");
    idx.add("b", "c1", "pizza pizza pizza");
    idx.add("c", "c1", "the weather is nice");
    const hits = idx.search("pizza");
    expect(hits.map((h) => h.id)).toEqual(["b", "a"]);
  });

  it("filters by chat and forgets removed documents", () => {
    const idx = new SearchIndex();
    idx.add("a", "c1", "see you tomorrow");
    idx.add("b", "c2", "see you tomorrow");
    expect(
      idx.search("tomorrow", { chatIds: ["c2"] }).map((h) => h.id),
    ).toEqual(["b"]);
    idx.remove("b");
    expect(idx.search("tomorrow")).toHaveLength(1);
    expect(idx.size).toBe(1);
  });

  it("returns nothing for an empty query", () => {
    const idx = new SearchIndex();
    idx.add("a", "c1", "hello");
    expect(idx.search("   ")).toEqual([]);
  });
});

describe("NodeStore", () => {
  it("evicts the oldest node and removes it from search", () => {
    const nodes = new NodeStore({ maxNodes: 2 });
    const first = nodes.add({ chatId: "c1", kind: "turn", text: "alpha note" });
    nodes.add({ chatId: "c1", kind: "turn", text: "beta note" });
    nodes.add({ chatId: "c1", kind: "turn", text: "gamma note" });
    expect(nodes.size).toBe(2);
    expect(nodes.get(first.id)).toBeUndefined();
    expect(nodes.search("alpha")).toEqual([]);
  });

  it("returns the newest nodes of one chat, oldest first", () => {
    const nodes = new NodeStore();
    nodes.add({ chatId: "c1", kind: "turn", text: "one" });
    nodes.add({ chatId: "c2", kind: "turn", text: "other" });
    nodes.add({ chatId: "c1", kind: "turn", text: "two" });
    nodes.add({ chatId: "c1", kind: "turn", text: "three" });
    expect(nodes.recent("c1", 2).map((n) => n.text)).toEqual(["two", "three"]);
  });
});

describe("MemoryHistoryStore", () => {
  it("returns a window for the model but keeps every turn searchable", async () => {
    const history = new MemoryHistoryStore({ maxTurns: 2 });
    await history.append("c1", [
      { role: "user", content: "we talked about the beach" },
      { role: "assistant", content: "nice" },
      { role: "user", content: "and then lunch" },
    ]);
    expect(await history.load("c1")).toEqual([
      { role: "assistant", content: "nice" },
      { role: "user", content: "and then lunch" },
    ]);
    expect(history.nodes.search("beach", { chatIds: ["c1"] })).toHaveLength(1);
  });
});

describe("createMemory", () => {
  it("recalls only the asked chat", async () => {
    const memory = createMemory();
    await memory.history.append("c1", [
      { role: "user", content: "the bakery opens at nine" },
    ]);
    await memory.history.append("c2", [
      { role: "user", content: "the bakery is closed" },
    ]);
    const hits = await memory.recall("c1", "bakery");
    expect(hits.map((h) => h.chatId)).toEqual(["c1"]);
  });
});

describe("FixedWindowRateLimiter per key", () => {
  it("counts each key in its own window", async () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter({
      maxPerWindow: 1,
      windowMs: 1000,
      now: () => now,
    });
    expect(await limiter.allow("a")).toBe(true);
    expect(await limiter.allow("a")).toBe(false);
    expect(await limiter.allow("b")).toBe(true);
    now = 1000;
    expect(await limiter.allow("a")).toBe(true);
  });
});
