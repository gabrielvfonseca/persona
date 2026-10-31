import { describe, expect, it } from "vitest";
import { kvDedupeStore, kvHistoryStore } from "../src/kv-stores";

describe("kvHistoryStore", () => {
  it("loads and appends turns", async () => {
    const store = new Map<string, string>();
    const kv = {
      delete: () => {
        /* intentionally empty */
        return Promise.resolve();
      },
      get: (k: string) => Promise.resolve(store.get(k) ?? null),
      put: (k: string, v: string) => {
        store.set(k, v);
        return Promise.resolve();
      },
    };
    const history = kvHistoryStore(kv);
    await history.append("c1", [{ content: "hi", role: "user" }]);
    const turns = await history.load("c1");
    expect(turns).toHaveLength(1);
    expect(turns[0]?.content).toBe("hi");
  });
});

describe("kvDedupeStore", () => {
  it("tracks dedupe keys", async () => {
    const store = new Map<string, string>();
    const kv = {
      delete: () => {
        /* intentionally empty */
        return Promise.resolve();
      },
      get: (k: string) => Promise.resolve(store.get(k) ?? null),
      put: (k: string, v: string) => {
        store.set(k, v);
        return Promise.resolve();
      },
    };
    const dedupe = kvDedupeStore(kv);
    expect(await dedupe.has("k1")).toBe(false);
    await dedupe.set("k1", 60_000);
    expect(await dedupe.has("k1")).toBe(true);
  });
});
