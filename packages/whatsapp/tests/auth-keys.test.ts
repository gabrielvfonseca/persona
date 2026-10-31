import { describe, expect, it, vi } from "vitest";
import { type KeyValueStorage, useKeyValueAuthState } from "../src/auth-state";

const PATTERN_1 = /pre-key key 1 is malformed/u;

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    delete(key: string) {
      return Promise.resolve(data.delete(key));
    },
    get<T = unknown>(key: string) {
      // Reads are typed by the caller; the stored value is always a string here.
      return Promise.resolve(data.get(key) as T | undefined);
    },
    // The auth state only ever stores JSON strings, so a put of anything else is a bug.
    put<T>(key: string, value: T) {
      if (typeof value !== "string") {
        return Promise.reject(new Error("expected a JSON string"));
      }
      data.set(key, value);
      return Promise.resolve();
    },
  };
}

describe("signal key reads", () => {
  it("returns stored keys with their byte values restored", async () => {
    const storage = memoryStorage();
    const { state } = await useKeyValueAuthState(storage);
    await state.keys.set({ session: { "jid-1": Buffer.from([1, 2, 3]) } });

    const got = await state.keys.get("session", ["jid-1"]);
    expect(got["jid-1"]).toBeInstanceOf(Uint8Array);
    expect(Array.from(got["jid-1"] ?? [])).toEqual([1, 2, 3]);
  });

  it("skips a malformed row and warns, instead of handing it to Baileys", async () => {
    const storage = memoryStorage();
    const { state } = await useKeyValueAuthState(storage);
    await state.keys.set({
      "pre-key": {
        "1": { private: Buffer.from([2]), public: Buffer.from([1]) },
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    // A pre-key must be a key pair. A bare number is malformed.
    const [preKeyName] = [...storage.data.keys()].filter((k) =>
      k.includes("pre-key")
    );
    if (preKeyName) {
      storage.data.set(preKeyName, JSON.stringify(42));
    }
    // A fresh state reads from storage, as after a restart. The first one caches what it wrote.
    const { state: restarted } = await useKeyValueAuthState(storage);
    const got = await restarted.keys.get("pre-key", ["1"]);

    expect(got).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(PATTERN_1));
    warn.mockRestore();
  });
});
