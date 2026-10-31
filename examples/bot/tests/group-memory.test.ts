import { createMemory, KNOWLEDGE_CHAT } from "@persona/memory";
import { describe, expect, it } from "vitest";
import type { GroupRecord } from "../src/memory/group-import";
import {
  importGroupExport,
  parseTimestamp,
  recordId,
} from "../src/memory/group-import";
import {
  GroupIndex,
  qualityScore,
  windowScore,
} from "../src/memory/group-index";
import { withGroupRecall } from "../src/memory/group-recall";

const DAY = 86_400_000;
const rec = (
  over: Partial<GroupRecord> & Pick<GroupRecord, "id" | "text">
): GroupRecord => ({
  group: "g",
  sender: "Caio",
  ts: 1_700_000_000_000,
  windowId: 0,
  ...over,
});

describe("parseTimestamp", () => {
  it("reads day-first exports to the second, in local time", () => {
    expect(parseTimestamp("29/10/2026, 18:50:01")).toBe(
      new Date(2026, 9, 29, 18, 50, 1).getTime()
    );
  });
  it("reads 12-hour times with AM and PM", () => {
    expect(parseTimestamp("10/29/26 6:50 PM")).toBe(
      parseTimestamp("29/10/2026 18:50")
    );
    expect(parseTimestamp("01/02/2026 12:05 AM")).toBe(
      Date.UTC(2026, 1, 1, 0, 5)
    );
  });
  it("reads month-first dates when the first number cannot be a day", () => {
    expect(parseTimestamp("10/29/26, 6:50 PM")).toBe(
      new Date(2026, 9, 29, 18, 50).getTime()
    );
  });
  it("returns 0 for text it cannot read", () => {
    expect(parseTimestamp("yesterday")).toBe(0);
  });
});

describe("importGroupExport", () => {
  const raw = [
    "[28/10/2026, 20:00:00] Caio: alguém sabe o endereço do bakery?",
    "[28/10/2026, 20:01:00] Eva: <Media omitted>",
    "[28/10/2026, 20:02:00] Dani: https://example.com/menu",
    "[28/10/2026, 20:03:00] Dani: é na rua azul 42",
    "[28/10/2026, 22:00:00] Bia: bom dia",
  ].join("\n");

  it("skips media, links and very short text", () => {
    const records = importGroupExport(raw, "bakery");
    expect(records.map((r) => r.sender)).toEqual(["Caio", "Dani", "Bia"]);
  });
  it("gives the same id to the same message on every import", () => {
    const [first] = importGroupExport(raw, "bakery");
    const [again] = importGroupExport(raw, "bakery");
    expect(first?.id).toBe(again?.id);
    expect(first?.id).toBe(
      recordId(
        "bakery",
        first?.ts ?? 0,
        "Caio",
        "alguém sabe o endereço do bakery?"
      )
    );
  });
  it("puts messages more than 30 minutes apart in different windows", () => {
    const records = importGroupExport(raw, "bakery");
    expect(records[1]?.windowId).toBe(records[0]?.windowId);
    expect(records[2]?.windowId).not.toBe(records[1]?.windowId);
  });
});

describe("qualityScore and windowScore", () => {
  it("ranks a useful sentence above a one-word reply", () => {
    expect(qualityScore("ok")).toBe(0);
    expect(qualityScore("the bakery opens at 7 am?")).toBeGreaterThan(
      qualityScore("sim")
    );
  });
  it("caps very long messages", () => {
    expect(qualityScore("x".repeat(400))).toBeLessThan(
      qualityScore("x".repeat(100))
    );
  });
  it("treats a 50-message window as fully active", () => {
    expect(windowScore(50)).toBeCloseTo(1);
    expect(windowScore(1)).toBeLessThan(windowScore(10));
  });
});

describe("GroupIndex.rank", () => {
  function indexWith(records: GroupRecord[]) {
    const memory = createMemory();
    const index = new GroupIndex(memory.nodes);
    index.add("g", records);
    return { index, memory };
  }

  it("returns nothing unless a keyword matches", () => {
    const { index } = indexWith([
      rec({ id: "1", text: "the bakery opens at seven" }),
    ]);
    expect(index.rank("parking garage")).toEqual([]);
  });

  it("prefers a fresher message when the keyword match is equal", () => {
    const now = 1_700_000_000_000 + 400 * DAY;
    const { index } = indexWith([
      rec({
        id: "old",
        text: "bakery opens at seven today",
        ts: 1_700_000_000_000,
        windowId: 0,
      }),
      rec({
        id: "new",
        text: "bakery opens at seven today",
        ts: now - DAY,
        windowId: 1,
      }),
    ]);
    const [first] = index.rank("bakery", { now });
    expect(first?.record.id).toBe("new");
  });

  it("returns the message before the match as context", () => {
    const { index } = indexWith([
      rec({ id: "1", text: "where is the new bakery", ts: 1000, windowId: 3 }),
      rec({
        id: "2",
        text: "rua azul number forty two",
        ts: 2000,
        windowId: 3,
      }),
    ]);
    const hit = index.rank("forty two bakery").find((h) => h.record.id === "2");
    expect(hit?.context?.id).toBe("1");
  });

  it("hides a deleted group without touching other groups", () => {
    const memory = createMemory();
    const index = new GroupIndex(memory.nodes);
    index.add("a", [rec({ group: "a", id: "a1", text: "bakery in group a" })]);
    index.add("b", [rec({ group: "b", id: "b1", text: "bakery in group b" })]);
    index.delete("a");
    expect(index.rank("bakery").map((h) => h.record.id)).toEqual(["b1"]);
    expect(index.summaries().map((s) => s.group)).toEqual(["b"]);
  });

  it("can be limited to one group", () => {
    const memory = createMemory();
    const index = new GroupIndex(memory.nodes);
    index.add("a", [rec({ group: "a", id: "a1", text: "bakery in group a" })]);
    index.add("b", [rec({ group: "b", id: "b1", text: "bakery in group b" })]);
    expect(
      index.rank("bakery", { group: "a" }).map((h) => h.record.id)
    ).toEqual(["a1"]);
  });
});

describe("withGroupRecall", () => {
  it("returns ranked group messages and leaves out unranked group nodes from the base", async () => {
    const base = createMemory();
    const index = new GroupIndex(base.nodes);
    index.add("g", [rec({ id: "1", text: "bakery opens at seven" })]);
    const memory = withGroupRecall(base, index);
    const hits = await memory.recall("any-chat", "bakery", 5);
    expect(hits.filter((n) => index.isIndexed(n.id))).toHaveLength(1);
    expect(hits.filter((n) => n.chatId === KNOWLEDGE_CHAT).length).toBe(
      hits.length
    );
    expect(new Set(hits.map((n) => n.id)).size).toBe(hits.length);
  });
});
