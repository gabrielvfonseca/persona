import { describe, expect, it } from "vitest";
import { kvDedupeStore, kvHistoryStore } from "../src/stores";

describe("kvHistoryStore", () => {
  it("loads and appends turns", async () => {
    const store = new Map<string, string>();
    const kv = {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => {
        store.set(k, v);
      },
      delete: async () => {},
    };
    const history = kvHistoryStore(kv);
    await history.append("c1", [{ role: "user", content: "hi" }]);
    const turns = await history.load("c1");
    expect(turns).toHaveLength(1);
    expect(turns[0]?.content).toBe("hi");
  });
});

describe("kvDedupeStore", () => {
  it("tracks dedupe keys", async () => {
    const store = new Map<string, string>();
    const kv = {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => {
        store.set(k, v);
      },
      delete: async () => {},
    };
    const dedupe = kvDedupeStore(kv);
    expect(await dedupe.has("k1")).toBe(false);
    await dedupe.set("k1", 60000);
    expect(await dedupe.has("k1")).toBe(true);
  });
});
