import {
  type Channel,
  contextKey,
  type IncomingMessage,
  type ReplyGenerator,
  type Turn,
} from "@persona/core";
import { createMemory } from "@persona/memory";
import { parsePersona } from "@persona/schemas";
import { describe, expect, it } from "vitest";
import { createPersona } from "../src/create";
import { buildSystemPrompt } from "../src/prompt";

/** A generator that records the system prompt of each call. */
function recordingGenerator(reply = "ok") {
  const calls: { system: string; messages: Turn[] }[] = [];
  const generator: ReplyGenerator = {
    generate(system, messages) {
      calls.push({ messages, system });
      return Promise.resolve(reply);
    },
  };
  return { calls, generator };
}

const silentChannel: Channel = {
  name: "test",
  send() {
    /* intentionally empty */
    return Promise.resolve();
  },
};

const persona = parsePersona({
  facts: [],
  name: "Ana",
  phrases: [],
  quotes: [],
  stats: { medianLen: 5, p90Len: 9 },
  styleGuide: "",
  version: 1,
});

const groupMsg = (id: string): IncomingMessage => ({
  chatId: "g1",
  id,
  isGroup: true,
  participantCount: 4,
  senderName: "Bia",
  text: "bora?",
});

describe("buildSystemPrompt word limit", () => {
  it("shows learned fractional limits as whole words", () => {
    const at = (maxWords: number) =>
      buildSystemPrompt(persona, {
        weights: {
          exampleBoost: 1,
          extraRules: [],
          maxWords,
          styleGuideStrength: 1,
        },
      });
    expect(at(15.4)).toContain("at most 15 words");
    expect(at(15.6)).toContain("at most 16 words");
    expect(at(0.2)).toContain("at most 1 words");
  });
});

describe("createPersona per-context weights", () => {
  it("renders each message with the weights for its context, falling back to the global ones", async () => {
    const { generator, calls } = recordingGenerator();
    const bot = createPersona({
      channel: silentChannel,
      contextWeights: (lookup) =>
        lookup.context === contextKey(groupMsg("x"))
          ? {
              prompt: {
                exampleBoost: 1,
                extraRules: [],
                maxWords: 30,
                styleGuideStrength: 1,
              },
              recall: { keywordWeight: 1, rrfK: 60, semanticWeight: 1 },
            }
          : undefined,
      generator,
      persona,
      policy: { direct: "always", group: "always" },
    });

    await bot.handle(groupMsg("1"));
    await bot.handle({ chatId: "dm1", id: "2", text: "oi" });

    expect(calls[0]?.system).toContain("at most 30 words");
    expect(calls[1]?.system).toContain("at most 15 words");
  });

  it("passes the context's recall weights to memory recall", async () => {
    const memory = createMemory();
    const seen: unknown[] = [];
    const realRecall = memory.recall.bind(memory);
    memory.recall = (chatId, query, limit, weights) => {
      seen.push(weights);
      return Promise.resolve(realRecall(chatId, query, limit, weights));
    };
    const bot = createPersona({
      channel: silentChannel,
      contextWeights: () => ({
        prompt: {
          exampleBoost: 1,
          extraRules: [],
          maxWords: 15,
          styleGuideStrength: 1,
        },
        recall: { keywordWeight: 0.2, rrfK: 60, semanticWeight: 2 },
      }),
      generator: recordingGenerator().generator,
      memory,
      persona,
      policy: { direct: "always", group: "always" },
      recallLimit: 3,
    });

    await bot.handle(groupMsg("3"));

    expect(seen).toEqual([{ keywordWeight: 0.2, rrfK: 60, semanticWeight: 2 }]);
  });
});

describe("topic phrases in the prompt", () => {
  it("lists the phrases used for the message's topic", () => {
    const text = buildSystemPrompt(persona, {
      topicPhrases: ["bora la", "topa sim"],
    });
    expect(text).toContain("Replies you have used for this topic:");
    expect(text).toContain("- topa sim");
  });

  it("leaves the hint out when there are no phrases", () => {
    expect(buildSystemPrompt(persona, { topicPhrases: [] })).not.toContain(
      "Replies you have used for this topic"
    );
  });

  it("shows a different prompt when the topic phrases change", async () => {
    const { generator, calls } = recordingGenerator();
    const bot = createPersona({
      channel: silentChannel,
      generator,
      persona,
      policy: { direct: "always" },
      topicPhrases: (topic) => (topic === "festa" ? ["bora la"] : undefined),
    });
    await bot.handle({ chatId: "dm1", id: "1", text: "festa hoje?" });
    await bot.handle({ chatId: "dm1", id: "2", text: "tudo bem?" });
    expect(calls[0]?.system).toContain("- bora la");
    expect(calls[1]?.system).not.toContain("- bora la");
  });
});
