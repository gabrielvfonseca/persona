import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "../src/db";
import { kvDedupeStore } from "../src/kv-stores";
import { PgKVStorage } from "../src/storage";
import { freshPool, TEST_DATABASE_URL } from "./helpers";

describe.skipIf(!TEST_DATABASE_URL)("PgKVStorage", () => {
  let pool: Pool;
  let kv: PgKVStorage;

  beforeEach(async () => {
    pool = await freshPool(TEST_DATABASE_URL as string);
    kv = new PgKVStorage(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("returns null for a missing key and round-trips a value", async () => {
    expect(await kv.get("missing")).toBeNull();
    await kv.put("a", "1");
    expect(await kv.get("a")).toBe("1");
  });

  it("overwrites an existing key", async () => {
    await kv.put("a", "1");
    await kv.put("a", "2");
    expect(await kv.get("a")).toBe("2");
  });

  it("deletes a key", async () => {
    await kv.put("a", "1");
    await kv.delete("a");
    expect(await kv.get("a")).toBeNull();
  });

  it("hides a key once its TTL has passed, and sweeps it", async () => {
    await kv.put("short", "x", { expirationTtl: 1 });
    await kv.put("long", "y", { expirationTtl: 3600 });
    await new Promise((r) => setTimeout(r, 1200));
    expect(await kv.get("short")).toBeNull();
    expect(await kv.get("long")).toBe("y");
    expect(await kv.sweepExpired()).toBe(1);
  });

  it("clears the TTL when a key is rewritten without one", async () => {
    await kv.put("a", "1", { expirationTtl: 1 });
    await kv.put("a", "2");
    await new Promise((r) => setTimeout(r, 1200));
    expect(await kv.get("a")).toBe("2");
  });

  it("backs the dedupe store from the kv stores", async () => {
    const dedupe = kvDedupeStore(kv);
    expect(await dedupe.has("msg-1")).toBe(false);
    await dedupe.set("msg-1", 600_000);
    expect(await dedupe.has("msg-1")).toBe(true);
  });
});
