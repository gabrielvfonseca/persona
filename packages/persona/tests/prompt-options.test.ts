import type { ReplyGenerator } from "@persona/core";
import { parsePersona } from "@persona/schemas";
import { describe, expect, it } from "vitest";
import { createPersona } from "../src/create";

const persona = parsePersona({
  version: 1,
  name: "Ana",
  styleGuide: "calm",
  stats: { medianLen: 1, p90Len: 1 },
  quotes: [],
  phrases: [],
  facts: [],
});

const channel = { name: "t", send: async () => {} };
const generator: ReplyGenerator = { generate: async () => "ok" };

// Known bug: createPersona always passes its own `weights` object to buildSystemPrompt,
// so the `prompt.maxWords` option is ignored. It.fails keeps the suite green while the
// bug exists and turns red once it is fixed, so the marker can be removed.
describe("known issue: prompt.maxWords is ignored by createPersona", () => {
  it.fails("uses prompt.maxWords when given", () => {
    const bot = createPersona({
      persona,
      channel,
      generator,
      prompt: { maxWords: 3 },
    });

    expect(bot.systemPrompt).toContain("Reply in at most 3 words.");
  });
});
