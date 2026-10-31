import { describe, expect, it } from "vitest";
import { LearningEngine } from "../src/engine";
import type { Outcome } from "../src/extract";
import { defaultLearningState } from "../src/store";
import { LearningSystem } from "../src/system";

const replied = (i: number): Outcome => ({
  historyTurns: [],
  msg: { chatId: "c", id: `m${i}`, text: `q${i}` },
  recallLines: [],
  replyText: `a${i}`,
  result: { kind: "replied" },
  systemPrompt: "",
  timestamp: i,
});

describe("LearningSystem.create", () => {
  it("restores saved ratings into an engine built from custom options", async () => {
    const data = new Map<string, string>();
    const store = {
      get: (key: string) => Promise.resolve(data.get(key) ?? null),
      set: (key: string, value: string) => {
        data.set(key, value);
      },
    };
    const first = await LearningSystem.create({
      engineOptions: { warmup: 0 },
      store,
    });
    await first.addRating("", "chat-1", 1);

    const second = await LearningSystem.create({
      engineOptions: { warmup: 0 },
      store,
    });

    expect(second.getState().goodCount).toBe(1);
    expect(second.getState().ratings).toHaveLength(1);
  });
});

describe("LearningEngine bounds", () => {
  it("keeps only the newest pending outcomes", () => {
    const engine = new LearningEngine(defaultLearningState(), {
      maxPending: 3,
      warmup: 0,
    });

    for (let i = 0; i < 5; i += 1) {
      engine.ingestOutcome(replied(i));
    }
    const entries = engine.drainDataset();

    expect(entries.map((e) => e.completion)).toEqual(["a2", "a3", "a4"]);
  });

  it("distills on a cadence even when it does not divide the pending cap", () => {
    const engine = new LearningEngine(defaultLearningState(), {
      distillEvery: 7,
      maxPending: 10,
      warmup: 0,
    });

    const due: boolean[] = [];
    for (let i = 1; i <= 14; i += 1) {
      due.push(engine.ingestOutcome(replied(i)));
    }

    expect(due.filter(Boolean)).toHaveLength(2);
    expect(due[6]).toBe(true);
    expect(due[13]).toBe(true);
  });

  it("keeps the newest ratings with their comments", () => {
    const engine = new LearningEngine(defaultLearningState(), {
      maxRatings: 2,
      warmup: 0,
    });

    engine.ingestFeedback(-1, "chat-1", "too vague");
    engine.ingestFeedback(1, "chat-2");
    engine.ingestFeedback(-1, "chat-3", "too long");

    const { ratings } = engine.getState();
    expect(ratings.map((r) => [r.chatId, r.rating, r.comment])).toEqual([
      ["chat-2", 1, undefined],
      ["chat-3", -1, "too long"],
    ]);
  });
});
