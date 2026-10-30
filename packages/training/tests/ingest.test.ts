import { describe, expect, it } from "vitest";
import { buildPersona, listSenders } from "../src/build-persona";
import { parseExport, segment } from "../src/parse-export";

describe("parseExport", () => {
  it("parses iOS bracket format", () => {
    const raw =
      "[10/29/2025, 14:23:45] Alice: hello\n[10/29/2025, 14:24:10] Bob: hi there";
    const msgs = parseExport(raw);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.sender).toBe("Alice");
    expect(msgs[0]?.text).toBe("hello");
  });
  it("parses Android dash format", () => {
    const raw = "10/29/2025, 14:23 - Alice: hello\n10/29/2025, 14:24 - Bob: hi";
    const msgs = parseExport(raw);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.sender).toBe("Alice");
  });
  it("handles multi-line continuation", () => {
    const raw =
      "[10/29/2025, 14:23:45] Alice: hello\nhow are you?\n[10/29/2025, 14:24:10] Bob: fine";
    const msgs = parseExport(raw);
    expect(msgs[0]?.text).toBe("hello\nhow are you?");
  });
});

describe("segment", () => {
  it("creates new window after gap > 30 min", () => {
    const msgs = [
      { sender: "A", text: "hi", ts: "2025-01-01T10:00:00" },
      { sender: "B", text: "hey", ts: "2025-01-01T10:10:00" },
      { sender: "A", text: "long time", ts: "2025-01-01T11:00:00" },
    ];
    const res = segment(msgs);
    expect(res[0]?.windowId).toBe(0);
    expect(res[1]?.windowId).toBe(0);
    expect(res[2]?.windowId).toBe(1);
  });
});

describe("buildPersona", () => {
  it("builds from messages", () => {
    const msgs = [
      { sender: "Alice", text: "hello" },
      { sender: "Alice", text: "how are you" },
      { sender: "Bob", text: "hi" },
    ];
    const p = buildPersona({ messages: msgs, sender: "Alice", name: "Alice" });
    expect(p.name).toBe("Alice");
    expect(p.stats.messageCount).toBe(2);
  });
  it("throws on unknown sender", () => {
    expect(() => buildPersona({ messages: [], sender: "Nobody" })).toThrow(
      "Unknown sender",
    );
  });
});

describe("listSenders", () => {
  it("orders by count", () => {
    const msgs = [
      { sender: "Alice", text: "a" },
      { sender: "Bob", text: "b" },
      { sender: "Alice", text: "c" },
      { sender: "Alice", text: "d" },
    ];
    const senders = listSenders(msgs);
    expect(senders[0]).toBe("Alice");
    expect(senders[1]).toBe("Bob");
  });
});
