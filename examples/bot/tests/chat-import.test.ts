import { describe, expect, it } from "vitest";
import {
  assignWindows,
  readChatExport,
  readChatTimestamp,
} from "../src/import/chat-json";
import { buildChatPersona, cleanText } from "../src/import/chat-persona";

const BLOCK = [/\bslur\b/iu];
const MESSAGES_HINT = /messages/u;
const SLUR_HINT = /slur/iu;

const entry = (
  sender: string,
  text: string,
  timestamp = "2022-04-01T10:00:00",
  type?: string
) => ({ sender, text, timestamp, ...(type ? { type } : {}) });

describe("readChatExport", () => {
  it("keeps plain text and drops system, media, deleted and placeholder entries", () => {
    const raw = {
      messages: [
        entry("Ana", "Olá", "2022-04-01T10:00:00"),
        entry(
          "Ana",
          "Messages and calls are end-to-end encrypted",
          "2022-04-01T10:00:00",
          "system"
        ),
        entry("Ana", "image", "2022-04-01T10:01:00", "media"),
        entry("Ana", "This message was deleted", "2022-04-01T10:02:00"),
        entry("Ana", "video note omitted", "2022-04-01T10:03:00"),
        entry("Ana", "Missed voice call", "2022-04-01T10:04:00"),
        entry("Ana", "   ", "2022-04-01T10:05:00"),
      ],
    };
    expect(readChatExport(raw).map((m) => m.text)).toEqual(["Olá"]);
  });

  it("reads ISO and WhatsApp-style timestamps", () => {
    expect(readChatTimestamp("2022-04-01T10:00:00")).toBe(
      new Date(2022, 3, 1, 10, 0, 0).getTime()
    );
    expect(readChatTimestamp("27/02/2022, 18:19:36")).toBe(
      new Date(2022, 1, 27, 18, 19, 36).getTime()
    );
    expect(readChatTimestamp("not a date")).toBe(0);
  });

  it("returns messages oldest first", () => {
    const out = readChatExport({
      messages: [
        entry("A", "second", "2022-04-01T10:05:00"),
        entry("A", "first", "2022-04-01T10:00:00"),
      ],
    });
    expect(out.map((m) => m.text)).toEqual(["first", "second"]);
  });

  it("refuses a file without a messages array", () => {
    expect(() => readChatExport({ chat: [] })).toThrow(MESSAGES_HINT);
    expect(() => readChatExport("nope")).toThrow(MESSAGES_HINT);
  });
});

describe("assignWindows", () => {
  it("starts a new window after a gap longer than the limit", () => {
    const msgs = readChatExport({
      messages: [
        entry("A", "a", "2022-04-01T10:00:00"),
        entry("B", "b", "2022-04-01T10:10:00"),
        entry("A", "c", "2022-04-01T11:00:00"),
      ],
    });
    expect(assignWindows(msgs).map((m) => m.windowId)).toEqual([0, 0, 1]);
  });
});

describe("cleanText", () => {
  it("drops mentions and invisible marks and collapses spaces", () => {
    expect(cleanText("\u200e oi  @filipe   tudo bem")).toBe("oi tudo bem");
  });
});

describe("buildChatPersona", () => {
  const group = assignWindows(
    readChatExport({
      messages: [
        entry("Bia", "vais à festa?", "2022-04-01T10:00:00"),
        entry("Pedro Andrade", "vou sim", "2022-04-01T10:01:00"),
        entry("Bia", "a que horas?", "2022-04-01T10:02:00"),
        entry("calhau", "às 22", "2022-04-01T10:03:00"),
        entry("Bia", "um slur aqui", "2022-04-01T10:04:00"),
        entry("Pedro Andrade", "um slur tb", "2022-04-01T10:05:00"),
        entry("Calhau[bot]", "automatic reply", "2022-04-01T10:06:00"),
      ],
    })
  );
  const direct = assignWindows(
    readChatExport({
      messages: [entry("calhau", "bora", "2022-04-02T10:00:00")],
    })
  );

  const persona = buildChatPersona(
    { direct, group },
    {
      aliases: ["Pedro Andrade", "calhau"],
      blocklist: BLOCK,
      name: "Calhau",
      styleGuide: "casual",
    }
  );

  it("counts every alias as the person", () => {
    expect(persona.name).toBe("Calhau");
    expect(persona.stats.messageCount).toBe(3);
    expect(persona.quotes).toEqual(
      expect.arrayContaining(["vou sim", "às 22", "bora"])
    );
  });

  it("never learns blocked lines", () => {
    const all = [...persona.quotes, ...persona.phrases];
    expect(all.some((t) => SLUR_HINT.test(t))).toBe(false);
  });

  it("pairs what others said with the person's reply, within the group chat only", () => {
    expect(persona.exchanges).toEqual([
      { assistant: "vou sim", user: "vais à festa?" },
      { assistant: "às 22", user: "a que horas?" },
    ]);
  });

  it("keeps phrases that repeat at least three times", () => {
    expect(persona.phrases).toEqual([]);
  });
});
