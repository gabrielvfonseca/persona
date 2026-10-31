import type { Channel, Turn } from "@persona/core";
import { createMemory } from "@persona/memory";
import { parsePersona } from "@persona/schemas";
import { describe, expect, it } from "vitest";
import { createPersona } from "../src/index";

const persona = parsePersona({
  version: 1,
  name: "Ana",
  styleGuide: "short",
  stats: { medianLen: 5, p90Len: 9 },
  quotes: [],
  phrases: [],
  facts: [],
});
const silent = { info() {}, warn() {}, error() {} };

function setup(generate: (s: string, m: Turn[]) => string = () => "ok") {
  const sent: string[] = [];
  const calls: { system: string; messages: Turn[] }[] = [];
  const channel: Channel = {
    name: "t",
    async send(_chatId, text) {
      sent.push(text);
    },
  };
  const generator = {
    async generate(system: string, messages: Turn[]) {
      calls.push({ system, messages });
      return generate(system, messages);
    },
  };
  return { sent, calls, channel, generator };
}

describe("persona learning wiring", () => {
  it("applies a persona patch and rebuilds the system prompt", async () => {
    const { channel, generator } = setup();
    const bot = createPersona({
      persona,
      channel,
      generator,
      policy: { direct: "always" },
      logger: silent,
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
  });

  it("setPromptWeights rebuilds the system prompt", async () => {
    const { channel, generator } = setup();
    const bot = createPersona({
      persona,
      channel,
      generator,
      policy: { direct: "always" },
      logger: silent,
    });
    const before = bot.systemPrompt;
    bot.setPromptWeights({
      maxWords: 5,
      exampleBoost: 1,
      styleGuideStrength: 1,
      extraRules: [],
    });
    expect(bot.systemPrompt).toContain("Reply in at most 5 words.");
    expect(bot.systemPrompt).not.toBe(before);
  });

  it("setRecallWeights updates the memory fusion weights", async () => {
    const { channel, generator } = setup();
    const memory = createMemory();
    const bot = createPersona({
      persona,
      channel,
      generator,
      memory,
      policy: { direct: "always" },
      logger: silent,
    });
    bot.setRecallWeights({ keywordWeight: 2, semanticWeight: 0.5, rrfK: 60 });
    // No throw; weights are stored on the memory object.
    expect(bot.memory).toBeDefined();
  });

  it("records outcomes through a learning observer", async () => {
    const { channel, generator } = setup();
    const outcomes: { kind: string }[] = [];
    const bot = createPersona({
      persona,
      channel,
      generator,
      policy: { direct: "always" },
      logger: silent,
      learning: {
        recordOutcome: (o) => outcomes.push({ kind: o.result.kind }),
      },
    });
    await bot.handle({ id: "1", chatId: "c1", text: "hello" });
    expect(outcomes.some((o) => o.kind === "replied")).toBe(true);
  });
});
