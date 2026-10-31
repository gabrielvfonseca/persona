import type { IncomingMessage, Turn } from "@persona/core";
import { describe, expect, it } from "vitest";
import { LearningEngine } from "../src/engine";
import { outcomeSignal, wasFailed, wasReplied } from "../src/extract";
import { defaultLearningState } from "../src/store";

const msg = (over: Partial<IncomingMessage> = {}): IncomingMessage => ({
  chatId: "c1",
  id: "1",
  text: "hi",
  ...over,
});

const ok = (over: Partial<IncomingMessage> = {}) => ({
  historyTurns: [] as Turn[],
  msg: msg(over),
  recallLines: [] as string[],
  replyText: "hi back",
  result: { kind: "replied" as const },
  systemPrompt: "sys",
  timestamp: 1,
});

const fail = (over: Partial<IncomingMessage> = {}) => ({
  historyTurns: [] as Turn[],
  msg: msg(over),
  recallLines: [] as string[],
  result: { error: new Error("boom"), kind: "failed" as const },
  systemPrompt: "sys",
  timestamp: 1,
});

const skipped = (over: Partial<IncomingMessage> = {}) => ({
  historyTurns: [] as Turn[],
  msg: msg(over),
  recallLines: [] as string[],
  result: { kind: "skipped" as const, reason: "paused" },
  systemPrompt: "sys",
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
    const engine = new LearningEngine(defaultLearningState(), {
      step: 1,
      warmup: 5,
    });
    for (let i = 0; i < 5; i += 1) {
      engine.ingestOutcome(ok());
    }
    expect(engine.getState().prompt.maxWords).toBe(15);
  });

  it("moves prompt weights toward longer replies on good outcomes", () => {
    const engine = new LearningEngine(defaultLearningState(), {
      step: 1,
      warmup: 0,
    });
    engine.ingestOutcome(ok());
    expect(engine.getState().prompt.maxWords).toBe(16);
  });

  it("tightens prompt weights on bad outcomes", () => {
    const engine = new LearningEngine(defaultLearningState(), {
      step: 1,
      warmup: 0,
    });
    engine.ingestOutcome(fail());
    expect(engine.getState().prompt.maxWords).toBe(14);
  });

  it("nudges the outcome's context and hour bucket as well as the global weights", () => {
    const engine = new LearningEngine(defaultLearningState(), {
      step: 1,
      warmup: 0,
    });
    engine.ingestOutcome(ok({ isGroup: true, participantCount: 4 }));
    const s = engine.getState();
    expect(s.contexts?.["group:4"]?.prompt.maxWords).toBe(16);
    expect(s.contexts?.["group:4"]?.recall.semanticWeight).toBeCloseTo(2);
    expect(s.contexts?.dm).toBeUndefined();
    const bucket = Object.keys(s.hourBuckets ?? {});
    expect(bucket).toHaveLength(1);
    expect(s.hourBuckets?.[bucket[0] ?? ""]?.prompt.maxWords).toBe(16);
  });

  it("seeds a new context from the global weights", () => {
    const state = defaultLearningState();
    state.prompt.maxWords = 22;
    const engine = new LearningEngine(state, { step: 0, warmup: 0 });
    engine.ingestOutcome(ok());
    expect(engine.getState().contexts?.dm?.prompt.maxWords).toBe(22);
  });

  it("nudges a correctly ignored group message up, and a missed DM down", () => {
    const engine = new LearningEngine(defaultLearningState(), {
      step: 1,
      warmup: 0,
    });
    engine.ingestOutcome({
      ...skipped({ isGroup: true, participantCount: 3 }),
      result: { kind: "skipped", reason: "not-addressed" },
    });
    expect(
      engine.getState().contexts?.["group:3"]?.recall.semanticWeight
    ).toBeCloseTo(1.3);

    engine.ingestOutcome({
      ...skipped(),
      result: { kind: "skipped", reason: "not-addressed" },
    });
    // The DM context seeds from the global weights, which the group outcome
    // already moved to 1.3, so it lands at 1.3 - 0.5.
    expect(engine.getState().contexts?.dm?.recall.semanticWeight).toBeCloseTo(
      0.8
    );
  });

  it("boosts a sender's step after good replies and caps the boost map at 50", () => {
    const engine = new LearningEngine(defaultLearningState(), {
      step: 1,
      warmup: 0,
    });
    engine.ingestOutcome({ ...ok(), senderId: "alice" });
    expect(engine.getState().senderBoost?.alice).toBeCloseTo(1.05);

    for (let i = 0; i < 60; i += 1) {
      engine.ingestOutcome({ ...ok(), senderId: `s${i}` });
    }
    expect(
      Object.keys(engine.getState().senderBoost ?? {}).length
    ).toBeLessThanOrEqual(50);
  });

  it("boosts semantic recall on good outcomes", () => {
    const engine = new LearningEngine(defaultLearningState(), {
      step: 1,
      warmup: 0,
    });
    engine.ingestOutcome(ok());
    expect(engine.getState().recall.semanticWeight).toBeCloseTo(2);
    expect(engine.getState().recall.keywordWeight).toBeCloseTo(0.5);
  });

  it("ingests feedback and counts it", () => {
    const engine = new LearningEngine(defaultLearningState(), {
      step: 0,
      warmup: 0,
    });
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
    for (let i = 0; i < 5; i += 1) {
      engine.ingestFeedback(-1);
    }
    const { patch } = engine.distill();
    expect(engine.getState().badCount).toBe(5);
    expect(patch.styleGuide).toContain("concise");
  });
});

describe("applyPatch", () => {
  it("merges facts and phrases without duplicates", async () => {
    const { applyPatch } = await import("../src/store");
    const target = { facts: ["a"], phrases: ["b"], styleGuide: "x" };
    const out = applyPatch(
      { facts: ["a", "c"], phrases: ["d"], styleGuide: "y" },
      target
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

describe("topic weights", () => {
  it("nudges the weights of the message's topic", () => {
    const engine = new LearningEngine(defaultLearningState(), {
      step: 1,
      warmup: 0,
    });
    engine.ingestOutcome({ ...ok(), topicTags: ["festa"] });
    expect(engine.getState().topics?.festa?.recall.semanticWeight).toBeCloseTo(
      2
    );
  });

  it("keeps at most 200 topics, evicting the oldest", () => {
    const engine = new LearningEngine(defaultLearningState(), {
      step: 1,
      warmup: 0,
    });
    for (let i = 0; i < 205; i += 1) {
      engine.ingestOutcome({ ...ok(), topicTags: [`t${i}`] });
    }
    const topics = Object.keys(engine.getState().topics ?? {});
    expect(topics).toHaveLength(200);
    expect(topics).not.toContain("t0");
    expect(topics).toContain("t204");
  });
});
