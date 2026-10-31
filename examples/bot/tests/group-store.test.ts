import { createPool, migrate, type Pool } from "@persona/postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GroupRecord } from "../src/memory/group-import";
import {
  assertGroupId,
  type GroupStore,
  memoryGroupStore,
  pgGroupStore,
} from "../src/memory/group-store";

const PATTERN_1 = /Group ids use/u;
const PATTERN_2 = /Group ids use/u;

const record = (over: Partial<GroupRecord> = {}): GroupRecord => ({
  group: "bakery",
  id: "r1",
  sender: "Caio",
  text: "alguém sabe o endereço?",
  ts: 1_700_000_000_000,
  windowId: 1,
  ...over,
});

/** The contract both implementations share. */
function storeContract(name: string, make: () => Promise<GroupStore>) {
  describe(name, () => {
    it("stores records once and reports how many were new", async () => {
      const store = await make();
      expect(
        await store.append("bakery", [record(), record({ id: "r2", ts: 1 })])
      ).toBe(2);
      expect(await store.append("bakery", [record()])).toBe(0);
    });

    it("reads a group's records oldest first, and lists the groups", async () => {
      const store = await make();
      await store.append("bakery", [record({ id: "late", ts: 2000 })]);
      await store.append("bakery", [record({ id: "early", ts: 1000 })]);
      await store.append("cafe", [record({ group: "cafe", id: "other" })]);

      expect((await store.read("bakery")).map((r) => r.id)).toEqual([
        "early",
        "late",
      ]);
      expect(await store.listGroups()).toEqual(["bakery", "cafe"]);
    });

    it("removes a group and reports whether it existed", async () => {
      const store = await make();
      await store.append("bakery", [record()]);
      expect(await store.remove("bakery")).toBe(true);
      expect(await store.remove("bakery")).toBe(false);
      expect(await store.read("bakery")).toEqual([]);
    });
  });
}

storeContract("memoryGroupStore", () => Promise.resolve(memoryGroupStore()));

describe("group ids", () => {
  it("accepts letters, digits, dot, dash and underscore", () => {
    expect(assertGroupId("bakery_01.v2-x")).toBe("bakery_01.v2-x");
  });

  it("refuses anything else", () => {
    expect(() => assertGroupId("../etc")).toThrow(PATTERN_1);
    expect(() => assertGroupId("")).toThrow(PATTERN_2);
  });
});

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";

describe.skipIf(!url)("pgGroupStore (Postgres)", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createPool(url, 4);
    await migrate(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  storeContract("pgGroupStore", async () => {
    await pool.query("TRUNCATE group_records");
    return pgGroupStore(pool);
  });

  it("stores a record's time as a number and keeps its window", async () => {
    await pool.query("TRUNCATE group_records");
    const store = pgGroupStore(pool);
    await store.append("bakery", [
      record({ ts: 1_700_000_123_456, windowId: 7 }),
    ]);
    const [stored] = await store.read("bakery");
    expect(stored).toMatchObject({ ts: 1_700_000_123_456, windowId: 7 });
  });
});
