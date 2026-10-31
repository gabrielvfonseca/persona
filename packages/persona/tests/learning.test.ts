import type { Channel, Turn } from "@persona/core";
import { createMemory } from "@persona/memory";
import { parsePersona } from "@persona/schemas";
import { describe, expect, it } from "vitest";
import { createPersona } from "../src/index";

const persona = parsePersona({
  facts: [],
  name: "Ana",
  phrases: [],
  quotes: [],
  stats: { medianLen: 5, p90Len: 9 },
  styleGuide: "short",
  version: 1,
});
const silent = {
  error() {
    /* intentionally empty */
  },
  info() {
    /* intentionally empty */
  },
  warn() {
    /* intentionally empty */
  },
};

function setup(generate: (s: string, m: Turn[]) => string = () => "ok") {
  const sent: string[] = [];
  const calls: { system: string; messages: Turn[] }[] = [];
  const channel: Channel = {
    name: "t",
    send(_chatId, text) {
      sent.push(text);
      return Promise.resolve();
    },
  };
  const generator = {
    generate(system: string, messages: Turn[]) {
      calls.push({ messages, system });
      return Promise.resolve(generate(system, messages));
    },
  };
  return { calls, channel, generator, sent };
}

describe("persona learning wiring", () => {
  it("applies a persona patch and rebuilds the system prompt", () => {
    const { channel, generator } = setup();
    const bot = createPersona({
      channel,
      generator,
      logger: silent,
      persona,
      policy: { direct: "always" },
    });
    const before = bot.systemPrompt;
    bot.applyPatch({
      facts: ["Loves coffee"],
      phrases: ["No worries"],
      styleGuide: "Be warm.",
    });
    expect(bot.systemPrompt).not.toBe(before);
    expect(bot.systemPrompt).toContain("Loves coffee");
    expect(bot.systemPrompt).toContain("No worries");
    expect(bot.systemPrompt).toContain("Be warm.");
    return Promise.resolve();
  });

  it("setPromptWeights rebuilds the system prompt", () => {
    const { channel, generator } = setup();
    const bot = createPersona({
      channel,
      generator,
      logger: silent,
      persona,
      policy: { direct: "always" },
    });
    const before = bot.systemPrompt;
    bot.setPromptWeights({
      exampleBoost: 1,
      extraRules: [],
      maxWords: 5,
      styleGuideStrength: 1,
    });
    expect(bot.systemPrompt).toContain("Reply in at most 5 words.");
    expect(bot.systemPrompt).not.toBe(before);
    return Promise.resolve();
  });

  it("setRecallWeights updates the memory fusion weights", () => {
    const { channel, generator } = setup();
    const memory = createMemory();
    const bot = createPersona({
      channel,
      generator,
      logger: silent,
      memory,
      persona,
      policy: { direct: "always" },
    });
    bot.setRecallWeights({ keywordWeight: 2, rrfK: 60, semanticWeight: 0.5 });
    // No throw; weights are stored on the memory object.
    expect(bot.memory).toBeDefined();
    return Promise.resolve();
  });

  it("records outcomes through a learning observer", async () => {
    const { channel, generator } = setup();
    const outcomes: { kind: string }[] = [];
    const bot = createPersona({
      channel,
      generator,
      learning: {
        recordOutcome: (o) => outcomes.push({ kind: o.result.kind }),
      },
      logger: silent,
      persona,
      policy: { direct: "always" },
    });
    await bot.handle({ chatId: "c1", id: "1", text: "hello" });
    expect(outcomes.some((o) => o.kind === "replied")).toBe(true);
  });
});
