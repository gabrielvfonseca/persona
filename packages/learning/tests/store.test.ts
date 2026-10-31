import { describe, expect, it } from "vitest";
import {
  applyPatch,
  defaultLearningState,
  loadLearningState,
  mergeLearningState,
  saveLearningState,
} from "../src/store";

function memoryStore(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) {
    data.set("learning:state", initial);
  }
  return {
    data,
    get: (key: string) => Promise.resolve(data.get(key) ?? null),
    set: (key: string, value: string) =>
      Promise.resolve(data.set(key, value) && undefined),
  };
}

/** A state as the v1 engine wrote it: flat weights only, no schemaVersion or maps. */
const v1State = {
  badCount: 1,
  feedbackCount: 3,
  goodCount: 2,
  prompt: {
    exampleBoost: 1.5,
    extraRules: [],
    maxWords: 22,
    styleGuideStrength: 1,
  },
  ratings: [],
  recall: { keywordWeight: 0.5, rrfK: 60, semanticWeight: 2 },
};

describe("v1 -> v2 migration", () => {
  it("keeps the flat weights and fills the new maps empty", () => {
    const merged = mergeLearningState(defaultLearningState(), v1State);
    expect(merged.schemaVersion).toBe(2);
    expect(merged.prompt.maxWords).toBe(22);
    expect(merged.prompt.exampleBoost).toBe(1.5);
    expect(merged.recall.semanticWeight).toBe(2);
    expect(merged.contexts).toEqual({});
    expect(merged.hourBuckets).toEqual({});
    expect(merged.senderBoost).toEqual({});
    expect(merged.goodCount).toBe(2);
  });

  it("loads a stored v1 state through loadLearningState", async () => {
    const store = memoryStore(JSON.stringify(v1State));
    const state = await loadLearningState(store);
    expect(state.schemaVersion).toBe(2);
    expect(state.prompt.maxWords).toBe(22);
    expect(state.contexts).toEqual({});
  });

  it("falls back to defaults when the stored state is corrupt", async () => {
    const state = await loadLearningState(memoryStore("{not json"));
    expect(state).toEqual(defaultLearningState());
  });

  it("round-trips per-context weights through save and load", async () => {
    const store = memoryStore();
    const state = defaultLearningState();
    state.contexts = {
      dm: {
        prompt: { ...state.prompt, maxWords: 18 },
        recall: { ...state.recall },
      },
    };
    state.senderBoost = { alice: 1.2 };
    await saveLearningState(store, state);
    const loaded = await loadLearningState(store);
    expect(loaded.contexts?.dm?.prompt.maxWords).toBe(18);
    expect(loaded.senderBoost?.alice).toBe(1.2);
  });
});

describe("applyPatch topic phrases", () => {
  it("merges topic phrases without duplicates", () => {
    const out = applyPatch(
      { topicPhrases: { food: ["bora comer", "bora"] } },
      {
        facts: [],
        phrases: [],
        styleGuide: "",
        topicPhrases: { food: ["bora"] },
      }
    );
    expect(out.topicPhrases).toEqual({ food: ["bora", "bora comer"] });
  });
});

describe("runtime validation of stored state", () => {
  it("ignores fields of the wrong type and keeps the defaults for them", () => {
    const merged = mergeLearningState(defaultLearningState(), {
      feedbackCount: "3",
      prompt: { exampleBoost: 2, maxWords: "twenty" },
      ratings: [{ at: 5, chatId: "c", rating: 1 }, { chatId: 7 }],
      senderBoost: { alice: 1.5, bob: "high" },
    });
    expect(merged.prompt.maxWords).toBe(15);
    expect(merged.prompt.exampleBoost).toBe(2);
    expect(merged.feedbackCount).toBe(0);
    expect(merged.senderBoost).toEqual({ alice: 1.5 });
    expect(merged.ratings).toEqual([
      { at: 5, chatId: "c", comment: undefined, rating: 1 },
    ]);
  });

  it("fills a context's missing weights from the global ones", () => {
    const defaults = defaultLearningState();
    defaults.prompt.maxWords = 22;
    const merged = mergeLearningState(defaults, {
      contexts: { dm: { prompt: { exampleBoost: 2 } } },
    });
    expect(merged.contexts?.dm?.prompt.maxWords).toBe(22);
    expect(merged.contexts?.dm?.prompt.exampleBoost).toBe(2);
    expect(merged.contexts?.dm?.recall.rrfK).toBe(60);
  });

  it("treats a stored value that is not an object as an empty state", () => {
    expect(mergeLearningState(defaultLearningState(), "nope")).toEqual(
      defaultLearningState()
    );
  });
});
