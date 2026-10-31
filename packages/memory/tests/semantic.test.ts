import type { Embedder } from "@persona/core";
import { describe, expect, it } from "vitest";
import {
  cosine,
  createMemory,
  KNOWLEDGE_CHAT,
  reciprocalRankFusion,
} from "../src/index";

/** Deterministic embedder: one dimension per known word, so similarity is predictable. */
const WORDS = ["cat", "dog", "car", "bakery"];
const fakeEmbedder: Embedder = {
  embed(texts) {
    return Promise.resolve(
      texts.map((t) => WORDS.map((w) => (t.toLowerCase().includes(w) ? 1 : 0)))
    );
  },
};
const failingEmbedder: Embedder = {
  embed() {
    return Promise.reject(new Error("provider down"));
  },
};

describe("cosine", () => {
  it("is 1 for parallel vectors and 0 for orthogonal ones", () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });
  it("is 0 when a vector is all zeros", () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe("reciprocalRankFusion", () => {
  it("ranks an id that appears high in several lists first", () => {
    expect(
      reciprocalRankFusion([
        ["a", "b"],
        ["b", "c"],
      ])
    ).toEqual(["b", "a", "c"]);
  });
});

describe("semantic recall", () => {
  it("ranks the message whose embedding matches the query first", async () => {
    const memory = createMemory({ embedder: fakeEmbedder });
    await memory.history.append("c1", [
      { content: "my dog needs a walk", role: "user" },
      { content: "the bakery opens at nine", role: "user" },
    ]);
    const hits = await memory.recall("c1", "dog", 1);
    expect(hits[0]?.text).toBe("my dog needs a walk");
  });

  it("falls back to keyword search when the embedder fails", async () => {
    const memory = createMemory({ embedder: failingEmbedder });
    await memory.history.append("c1", [
      { content: "the bakery opens at nine", role: "user" },
    ]);
    const hits = await memory.recall("c1", "bakery", 3);
    expect(hits.map((h) => h.text)).toEqual(["the bakery opens at nine"]);
    expect(memory.nodes.recent("c1", 5)[0]?.embedding).toBeUndefined();
  });

  it("stores embeddings on turns when an embedder is set", async () => {
    const memory = createMemory({ embedder: fakeEmbedder });
    await memory.history.append("c1", [{ content: "a cat", role: "user" }]);
    expect(memory.nodes.recent("c1", 1)[0]?.embedding).toEqual([1, 0, 0, 0]);
  });
});

describe("knowledge", () => {
  it("learned facts are recalled in every chat", async () => {
    const memory = createMemory({ embedder: fakeEmbedder });
    await memory.learn("the bakery is on Rua Azul");
    const hits = await memory.recall("any-chat", "bakery", 3);
    expect(hits.map((h) => h.chatId)).toEqual([KNOWLEDGE_CHAT]);
  });

  it("chat messages stay private to their chat", async () => {
    const memory = createMemory();
    await memory.remember("c1", "secret bakery code 42", "fact");
    expect(await memory.recall("c2", "bakery code", 3)).toEqual([]);
  });
});
