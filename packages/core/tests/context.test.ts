import { describe, expect, it } from "vitest";
import {
  type ContextWeights,
  contextLookup,
  defaultContextWeights,
  type LearningState,
  resolveContextWeights,
} from "../src/index";

function defaultLearningState(): LearningState {
  return {
    badCount: 0,
    feedbackCount: 0,
    goodCount: 0,
    prompt: {
      exampleBoost: 1,
      extraRules: [],
      maxWords: 15,
      styleGuideStrength: 1,
    },
    ratings: [],
    recall: { keywordWeight: 1, rrfK: 60, semanticWeight: 1 },
  };
}

const weights = (maxWords: number): ContextWeights => ({
  prompt: { exampleBoost: 1, extraRules: [], maxWords, styleGuideStrength: 1 },
  recall: { keywordWeight: 1, rrfK: 60, semanticWeight: 1 },
});

describe("contextLookup", () => {
  it("takes the topic from the message text, not the sender name", () => {
    const lookup = contextLookup({
      chatId: "g",
      id: "1",
      isGroup: true,
      senderName: "Bia",
      text: "festa no sábado",
    });
    expect(lookup).toEqual({ context: "group", topic: "festa" });
  });
});

describe("resolveContextWeights", () => {
  it("prefers a topic's weights over its context's", () => {
    const state = defaultLearningState();
    state.contexts = { dm: weights(20) };
    state.topics = { festa: weights(40) };
    expect(
      resolveContextWeights(state, { context: "dm", topic: "festa" })?.prompt
        .maxWords
    ).toBe(40);
  });

  it("falls back to the context, then to nothing", () => {
    const state = defaultLearningState();
    state.contexts = { dm: weights(20) };
    expect(
      resolveContextWeights(state, { context: "dm", topic: "jogo" })?.prompt
        .maxWords
    ).toBe(20);
    expect(resolveContextWeights(state, { context: "group" })).toBeUndefined();
  });

  it("seeds new weights from the global defaults", () => {
    const state = defaultLearningState();
    state.prompt.maxWords = 22;
    expect(defaultContextWeights(state).prompt.maxWords).toBe(22);
  });
});
