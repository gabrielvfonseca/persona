import type { IncomingMessage } from "@persona/core";
import { contextKey, hourBucket } from "@persona/core";
import { describe, expect, it } from "vitest";
import type { Outcome } from "../src/extract";
import { extractFact, outcomeSignal } from "../src/extract";

const base = (over: Partial<IncomingMessage> = {}) => ({
  historyTurns: [],
  msg: {
    chatId: "c",
    id: "1",
    text: "vamos?",
    ...over,
  } satisfies IncomingMessage,
  recallLines: [],
  systemPrompt: "",
  timestamp: 0,
});

const skip = (
  reason: string,
  over: Partial<IncomingMessage> = {}
): Outcome => ({
  ...base(over),
  result: { kind: "skipped", reason },
});

const replied = (extra: Partial<Outcome> = {}): Outcome => ({
  ...base(),
  replyText: "bora",
  result: { kind: "replied" },
  ...extra,
});

describe("contextKey", () => {
  it("keys direct chats as dm, and groups by participant count when known", () => {
    expect(contextKey({ chatId: "c", id: "1", text: "" })).toBe("dm");
    expect(contextKey({ chatId: "g", id: "1", isGroup: true, text: "" })).toBe(
      "group"
    );
    expect(
      contextKey({
        chatId: "g",
        id: "1",
        isGroup: true,
        participantCount: 7,
        text: "",
      })
    ).toBe("group:7");
  });
});

describe("hourBucket", () => {
  it("maps each local hour to one of twelve two-hour buckets", () => {
    const at = (h: number) => hourBucket(new Date(2026, 0, 1, h, 30).getTime());
    expect(at(0)).toBe("h0");
    expect(at(1)).toBe("h0");
    expect(at(2)).toBe("h1");
    expect(at(23)).toBe("h11");
  });
});

describe("outcomeSignal", () => {
  it("scores a skipped group message up, and a skipped DM down", () => {
    expect(outcomeSignal(skip("not-addressed", { isGroup: true }))).toBe(0.3);
    expect(outcomeSignal(skip("not-addressed"))).toBe(-0.5);
  });

  it("scores empty and guard skips negative, and duplicate/rate-limited/paused as neutral", () => {
    expect(outcomeSignal(skip("empty"))).toBe(-0.5);
    expect(outcomeSignal(skip("guard"))).toBe(-0.3);
    expect(outcomeSignal(skip("duplicate"))).toBe(0);
    expect(outcomeSignal(skip("rate-limited"))).toBe(0);
    expect(outcomeSignal(skip("paused"))).toBe(0);
  });

  it("treats a clean reply as +1 when no quality data is present", () => {
    expect(outcomeSignal(replied())).toBe(1);
  });

  it("leaves replies within 2x of the persona's median length at full quality", () => {
    expect(outcomeSignal(replied({ lengthRatio: 1 }))).toBe(1);
    expect(outcomeSignal(replied({ lengthRatio: 0.5 }))).toBe(1);
    expect(outcomeSignal(replied({ lengthRatio: 1.9 }))).toBe(1);
  });

  it("penalises replies far from the median length, and extreme ones go negative", () => {
    expect(outcomeSignal(replied({ lengthRatio: 4 }))).toBeCloseTo(0.5);
    expect(outcomeSignal(replied({ lengthRatio: 16 }))).toBeCloseTo(-0.5);
    expect(outcomeSignal(replied({ lengthRatio: 64 }))).toBe(-1);
  });

  it("lowers a reply that the guards transformed or that echoes a persona quote", () => {
    expect(outcomeSignal(replied({ transformed: true }))).toBeCloseTo(0.7);
    expect(outcomeSignal(replied({ repeatScore: 0.9 }))).toBeCloseTo(0.73);
  });

  it("is 0 for commands and -1 for failures", () => {
    expect(outcomeSignal({ ...base(), result: { kind: "command" } })).toBe(0);
    expect(
      outcomeSignal({ ...base(), result: { error: "x", kind: "failed" } })
    ).toBe(-1);
  });
});

describe("extractFact", () => {
  it("keeps a time or date answer to a when-question", () => {
    expect(extractFact("when is the meeting?", "tomorrow at 3pm")).toBe(
      "tomorrow at 3pm"
    );
  });

  it("keeps a place answer to a where-question", () => {
    expect(extractFact("where is the party?", "at Rua Augusta 200")).toBe(
      "at Rua Augusta 200"
    );
  });

  it("ignores replies that do not answer the question asked", () => {
    expect(extractFact("where is the party?", "sounds fun")).toBeUndefined();
  });

  it("recognises Portuguese when and where questions", () => {
    expect(extractFact("quando é a festa?", "amanhã às 20:00")).toBe(
      "amanhã às 20:00"
    );
    expect(extractFact("onde vai ser?", "no Shopping Iguatemi")).toBe(
      "no Shopping Iguatemi"
    );
    expect(extractFact("onde vai ser?", "boa pergunta")).toBeUndefined();
  });
});
