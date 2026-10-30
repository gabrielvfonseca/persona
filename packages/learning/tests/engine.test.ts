import type { IncomingMessage, Turn } from "@persona/core";
import { describe, expect, it, vi } from "vitest";
import { LearningEngine } from "../src/engine";
import { defaultLearningState } from "../src/store";
import { outcomeSignal, wasReplied, wasFailed } from "../src/extract";

const msg = (over: Partial<IncomingMessage> = {}): IncomingMessage => ({
  id: "1",
  chatId: "c1",
  text: "hi",
  ...over,
});

const ok = (over: Partial<IncomingMessage> = {}) => ({
  msg: msg(over),
  result: { kind: "replied" as const },
  systemPrompt: "sys",
  historyTurns: [] as Turn[],
  recallLines: [] as string[],
  replyText: "hi back",
  timestamp: 1,
});

const fail = (over: Partial<IncomingMessage> = {}) => ({
  msg: msg(over),
  result: { kind: "failed" as const, error: new Error("boom") },
  systemPrompt: "sys",
  historyTurns: [] as Turn[],
  recallLines: [] as string[],
  timestamp: 1,
});

const skipped = (over: Partial<IncomingMessage> = {}) => ({
  msg: msg(over),
  result: { kind: "skipped" as const, reason: "paused" },
  systemPrompt: "sys",
  historyTurns: [] as Turn[],
  recallLines: [] as string[],
  timestamp: 1,
});

describe("outcomeSignal", () => {
  it("is 1 for replied, -1 for failed, 0 otherwise", () => {
    expect(outcomeSignal(ok())).toBe(1);
    expect(outcomeSignal(fail())).toBe(-1);
    expect(outcomeSignal(skipped())).toBe(0);
  });
});

describe("wasReplied / wasFailed", () => {
  it("flags the right outcomes", () => {
    expect(wasReplied(ok())).toBe(true);
    expect(wasReplied(fail())).toBe(false);
    expect(wasFailed(fail())).toBe(true);
    expect(wasFailed(ok())).toBe(false);
  });
});

describe("LearningEngine", () => {
  it("starts from defaults", () => {
    const engine = new LearningEngine(defaultLearningState());
    expect(engine.getState().prompt.maxWords).toBe(15);
    expect(engine.getState().recall.keywordWeight).toBe(1);
  });

  it("does not move weights during warmup", () => {
    const engine = new LearningEngine(defaultLearningState(), { warmup: 5, step: 1 });
    for (let i = 0; i < 5; i++) engine.ingestOutcome(ok());
    expect(engine.getState().prompt.maxWords).toBe(15);
  });

  it("moves prompt weights toward longer replies on good outcomes", () => {
    const engine = new LearningEngine(defaultLearningState(), { warmup: 0, step: 1 });
    engine.ingestOutcome(ok());
    expect(engine.getState().prompt.maxWords).toBe(16);
  });

  it("tightens prompt weights on bad outcomes", () => {
    const engine = new LearningEngine(defaultLearningState(), { warmup: 0, step: 1 });
    engine.ingestOutcome(fail());
    expect(engine.getState().prompt.maxWords).toBe(14);
  });

  it("boosts semantic recall on good outcomes", () => {
    const engine = new LearningEngine(defaultLearningState(), { warmup: 0, step: 1 });
    engine.ingestOutcome(ok());
    expect(engine.getState().recall.semanticWeight).toBeCloseTo(2);
    expect(engine.getState().recall.keywordWeight).toBeCloseTo(0.5);
  });

  it("ingests feedback and counts it", () => {
    const engine = new LearningEngine(defaultLearningState(), { warmup: 0, step: 0 });
    engine.ingestFeedback(1);
    engine.ingestFeedback(-1);
    const s = engine.getState();
    expect(s.feedbackCount).toBe(2);
    expect(s.goodCount).toBe(1);
    expect(s.badCount).toBe(1);
  });

  it("drains the fine-tune dataset from replied outcomes", () => {
    const engine = new LearningEngine(defaultLearningState());
    engine.ingestOutcome(ok({ text: "what time" }));
    engine.ingestOutcome(skipped());
    engine.ingestOutcome(fail());
    const entries = engine.drainDataset();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.completion).toBe("hi back");
    expect(entries[0]?.messages[0]?.content).toBe("what time");
  });

  it("returns a patch on distill", () => {
    const engine = new LearningEngine(defaultLearningState(), { warmup: 0 });
    engine.ingestOutcome(ok({ text: "who are you" }));
    const { patch } = engine.distill();
    expect(patch.facts?.length ?? 0).toBeGreaterThan(0);
    expect(engine.getState().lastDistillAt).toBeDefined();
  });

  it("tightens the style guide when bad outcomes dominate", () => {
    const engine = new LearningEngine(defaultLearningState(), { warmup: 0 });
    for (let i = 0; i < 5; i++) engine.ingestOutcome(fail());
    engine.distill();
    // badCount > goodCount so the style guide should tighten.
    expect(engine.getState().badCount).toBeGreaterThan(0);
  });
});

describe("applyPatch", () => {
  it("merges facts and phrases without duplicates", async () => {
    const { applyPatch } = await import("../src/store");
    const target = { facts: ["a"], phrases: ["b"], styleGuide: "x" };
    const out = applyPatch(
      { facts: ["a", "c"], phrases: ["d"], styleGuide: "y" },
      target,
    );
    expect(out.facts).toEqual(["a", "c"]);
    expect(out.phrases).toEqual(["b", "d"]);
    expect(out.styleGuide).toBe("x\n\ny");
  });
});

describe("defaultLearningState", () => {
  it("has stable defaults", () => {
    const s = defaultLearningState();
    expect(s.prompt.maxWords).toBe(15);
    expect(s.recall.rrfK).toBe(60);
    expect(s.feedbackCount).toBe(0);
  });
});