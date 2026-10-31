import type { ReplyGenerator } from "@persona/core";
import { parsePersona } from "@persona/schemas";
import { describe, expect, it } from "vitest";
import { createPersona } from "../src/create";

const persona = parsePersona({
  facts: [],
  name: "Ana",
  phrases: [],
  quotes: [],
  stats: { medianLen: 1, p90Len: 1 },
  styleGuide: "calm",
  version: 1,
});

const channel = {
  name: "t",
  send: () => {
    /* intentionally empty */
    return Promise.resolve();
  },
};
const generator: ReplyGenerator = { generate: () => Promise.resolve("ok") };

describe("createPersona prompt length", () => {
  it("uses prompt.maxWords when no weights are given", () => {
    const bot = createPersona({
      channel,
      generator,
      persona,
      prompt: { maxWords: 3 },
    });

    expect(bot.systemPrompt).toContain("Reply in at most 3 words.");
  });

  it("defaults to 15 words when neither is given", () => {
    const bot = createPersona({ channel, generator, persona });

    expect(bot.systemPrompt).toContain("Reply in at most 15 words.");
  });

  it("lets explicit weights win over prompt.maxWords", () => {
    const bot = createPersona({
      channel,
      generator,
      persona,
      prompt: { maxWords: 3 },
      weights: {
        exampleBoost: 1,
        extraRules: [],
        maxWords: 7,
        styleGuideStrength: 1,
      },
    });

    expect(bot.systemPrompt).toContain("Reply in at most 7 words.");
  });

  it("keeps prompt.maxWords when weights are changed at runtime without maxWords", () => {
    const bot = createPersona({
      channel,
      generator,
      persona,
      prompt: { maxWords: 3 },
    });

    bot.setPromptWeights({
      exampleBoost: 1,
      extraRules: [],
      maxWords: 9,
      styleGuideStrength: 1,
    });

    expect(bot.systemPrompt).toContain("Reply in at most 9 words.");
  });
});
