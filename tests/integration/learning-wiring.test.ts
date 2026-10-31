import { join } from "node:path";
import type { ReplyGenerator } from "@persona/core";
import { describe, expect, it, vi } from "vitest";
import { buildBot } from "../../examples/bot/src/bot";
import { parseConfig } from "../../examples/bot/src/config";
import {
  type DatasetSink,
  memoryLearningStore,
} from "../../examples/bot/src/learning";
import { loadPersona } from "../../examples/bot/src/persona-file";
import { fakeChannel } from "../helpers/fakes";

const PATTERN_1 = /^Distilled: \d+ facts, \d+ phrases\.$/u;
const PATTERN_2 = /in memory only/u;

/** A model stand-in: replies without loading anything. */
const stubGenerator: ReplyGenerator = {
  generate: () => Promise.resolve("Sure, lets go"),
};

const personaPath = join(
  import.meta.dirname,
  "../../examples/bot/data/persona.example.json"
);
const admin = "5511999999999";

const env = {
  ADMIN_NUMBERS: admin,
  DATABASE_URL: "postgres://persona:persona@localhost:5432/persona",
  LEARNING_ENABLED: "true",
  LEARNING_WARMUP: "0",
  PERSONA_CONSENT: "true",
  PERSONA_MODEL: "qwen2.5-0.5b",
  PERSONA_NAME: "Ana",
};

function memorySink() {
  const saved: unknown[][] = [];
  const sink: DatasetSink = {
    save(entries) {
      saved.push(entries);
      return Promise.resolve(`test sink ${saved.length}`);
    },
  };
  return { saved, sink };
}

async function start(
  overrides: Record<string, string | undefined> = {},
  opts: {
    store?: ReturnType<typeof memoryLearningStore>;
    sink?: DatasetSink;
    warn?: () => void;
  } = {}
) {
  const channel = fakeChannel();
  const bot = await buildBot({
    channel,
    config: parseConfig({ ...env, ...overrides }),
    datasetSink: opts.sink,
    generator: stubGenerator,
    learningStore: opts.store,
    logger: {
      error() {
        /* intentionally empty */
      },
      info() {
        /* intentionally empty */
      },
      warn:
        opts.warn ??
        (() => {
          /* intentionally empty */
        }),
    },
    persona: loadPersona(personaPath),
  });
  let id = 0;
  const say = (text: string, senderId?: string) => {
    id += 1;
    return bot.handle({ chatId: "chat-1", id: `m${id}`, senderId, text });
  };
  return { bot, channel, lastReply: () => channel.sent.at(-1)?.text, say };
}

describe("learning wired into the example app", () => {
  it("moves the prompt after a good reply and applies it to the live bot", async () => {
    const { bot, say } = await start();

    await say("hi Ana, how are you?");

    expect(bot.systemPrompt).toContain("Reply in at most 16 words.");
  });

  it("applies admin ratings, saves them, and reports weights", async () => {
    const store = memoryLearningStore();
    const { say, lastReply } = await start({}, { store });

    await say("!good", admin);
    expect(lastReply()).toBe("Marked good.");
    await say("!bad too vague", admin);
    expect(lastReply()).toBe("Marked bad: too vague");

    const saved = JSON.parse(store.data.get("learning:state") ?? "{}");
    expect(saved.goodCount).toBe(1);
    expect(saved.badCount).toBe(1);
    expect(saved.ratings.at(-1)).toMatchObject({
      comment: "too vague",
      rating: -1,
    });

    await say("!weights", admin);
    expect(JSON.parse(lastReply() ?? "{}").feedback).toEqual({
      bad: 1,
      good: 1,
      total: 2,
    });
  });

  it("adds a fact with !learn and puts it in the system prompt", async () => {
    const { bot, say, lastReply } = await start();

    await say("!learn likes green tea", admin);

    expect(lastReply()).toBe("Learned.");
    expect(bot.systemPrompt).toContain("likes green tea");
  });

  it("distills on demand and reports what it added", async () => {
    const { say, lastReply } = await start();

    await say("hi Ana");
    await say("!distill", admin);

    expect(lastReply()).toMatch(PATTERN_1);
  });

  it("exports the dataset once, then reports nothing new", async () => {
    const { sink, saved } = memorySink();
    const { say, lastReply } = await start({}, { sink });

    await say("hi Ana");
    await say("!dataset", admin);
    expect(lastReply()).toBe("Saved 1 entries to test sink 1.");
    expect(saved[0]).toHaveLength(1);

    await say("!dataset", admin);
    expect(lastReply()).toBe("No new dataset entries.");
  });

  it("says no dataset location is set when none is configured", async () => {
    const { say, lastReply } = await start();

    await say("!dataset", admin);

    expect(lastReply()).toBe("No dataset location is configured.");
  });

  it("keeps learning across a restart when the same store is used", async () => {
    const store = memoryLearningStore();
    const first = await start({}, { store });
    await first.say("hi Ana");
    await first.say("!good", admin); // ratings always save

    const second = await start({}, { store });
    await second.say("!weights", admin);

    expect(JSON.parse(second.lastReply() ?? "{}").feedback.good).toBe(1);
    // At the default step of 0.5, a reply and a good rating each add half a word
    // (15 -> 15.5 -> 16), restored after the restart and shown as whole words.
    expect(second.bot.systemPrompt).toContain("Reply in at most 16 words.");
  });

  it("warns that learning is in memory when no store is configured", async () => {
    const warn = vi.fn();
    await start({}, { warn });

    expect(warn).toHaveBeenCalledWith(expect.stringMatching(PATTERN_2));
  });

  it("answers the rating commands with 'not enabled' when learning is off", async () => {
    // LEARNING_ENABLED must be "true" or absent, so "off" means the key is not set.
    const { LEARNING_ENABLED: _off, ...withoutLearning } = env;
    const { say, lastReply } = await start({
      ...withoutLearning,
      LEARNING_ENABLED: undefined,
    });

    await say("!good", admin);

    expect(lastReply()).toBe("Learning is not enabled.");
  });
});
