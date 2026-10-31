import type { PersonaPatch } from "@persona/core";
import {
  defaultLearningState,
  LearningEngine,
  type LearningStore,
  LearningSystem,
} from "@persona/learning";
import { type ConfiguredPersona, createPersona } from "@persona/persona";
import { describe, expect, it } from "vitest";
import {
  fakeChannel,
  fakeGenerator,
  persona,
  silentLogger,
} from "../helpers/fakes";

const PATTERN_1 = /Be concise/u;

function mapStore(
  initial?: string
): LearningStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) {
    data.set("learning:state", initial);
  }
  return {
    data,
    get: (key) => Promise.resolve(data.get(key) ?? null),
    set: (key, value) => {
      data.set(key, value);
      return Promise.resolve();
    },
  };
}

/** Wires a real bot to a LearningSystem, the way examples/bot will once learning is on. */
async function learningBot(
  opts: {
    store?: LearningStore;
    reply?: string;
    generator?: ReturnType<typeof fakeGenerator>;
    warmup?: number;
    step?: number;
  } = {}
) {
  const store = opts.store ?? mapStore();
  const patches: PersonaPatch[] = [];
  let bot: ConfiguredPersona | undefined;
  const system = await LearningSystem.create({
    engine: new LearningEngine(defaultLearningState(), {
      distillEvery: 1000,
      step: opts.step ?? 1,
      warmup: opts.warmup ?? 0,
    }),
    onPatch: (patch) => {
      patches.push(patch);
      bot?.applyPatch(patch);
    },
    store,
  });
  const channel = fakeChannel();
  const generator = opts.generator ?? fakeGenerator(opts.reply ?? "Sure thing");
  bot = createPersona({
    channel,
    generator,
    learning: system,
    logger: silentLogger,
    persona: persona(),
    policy: { direct: "always" },
  });
  return { bot, channel, generator, patches, store, system };
}

const msg = (id: string, text: string) => ({ chatId: "chat-1", id, text });

describe("learning observes the real pipeline", () => {
  it("raises prompt weights after a replied turn", async () => {
    const { bot, system } = await learningBot();

    await bot.handle(msg("1", "hi"));

    expect(system.getState().prompt.maxWords).toBe(16);
  });

  it("lowers prompt weights after a failed turn", async () => {
    const generator = fakeGenerator(() => {
      throw new Error("model down");
    });
    const { bot, system } = await learningBot({ generator });

    await bot.handle(msg("1", "hi"));

    expect(system.getState().prompt.maxWords).toBe(14);
  });

  it("leaves weights alone for commands", async () => {
    const { bot, system, generator } = await learningBot();

    await bot.handle(msg("1", "!whois"));

    expect(generator.calls).toHaveLength(0);
    expect(system.getState().prompt.maxWords).toBe(15);
    expect(system.getState().contexts?.dm).toBeUndefined();
  });

  it("nudges the group context when the bot correctly stays quiet", async () => {
    const { bot, system, generator } = await learningBot({ step: 1 });

    await bot.handle({
      chatId: "group-1",
      id: "2",
      isGroup: true,
      senderName: "Bia",
      text: "anyone up for lunch?",
    });

    // The group policy is "addressed", so the bot never calls the model.
    expect(generator.calls).toHaveLength(0);
    expect(
      system.getState().contexts?.group?.recall.semanticWeight
    ).toBeCloseTo(1.3);
  });

  it("nudges the DM context after a replied turn", async () => {
    const { bot, system } = await learningBot();

    await bot.handle(msg("1", "hi"));

    expect(system.getState().contexts?.dm?.prompt.maxWords).toBe(16);
  });

  it("moves prompt weights after a good rating once warmup is reached", async () => {
    const { system } = await learningBot();

    await system.addRating("r-1", "chat-1", 1);

    expect(system.getState().prompt.maxWords).toBe(16);
    expect(system.getState().goodCount).toBe(1);
  });

  it("does not move weights during warmup", async () => {
    const { system } = await learningBot({ step: 1, warmup: 5 });

    await system.addRating("r-1", "chat-1", 1);

    expect(system.getState().prompt.maxWords).toBe(15);
    expect(system.getState().goodCount).toBe(1);
  });

  it("pushes the new prompt to the live bot through setPromptWeights", async () => {
    const { bot, system } = await learningBot();
    bot.setPromptWeights(system.getState().prompt);

    await system.addRating("r-1", "chat-1", 1);
    bot.setPromptWeights(system.getState().prompt);

    expect(bot.systemPrompt).toContain("Reply in at most 16 words.");
  });
});

describe("distillation", () => {
  it("turns short good replies into phrases and applies them to the persona", async () => {
    const { bot, system, patches } = await learningBot({ reply: "bora la" });

    await bot.handle(msg("1", "vamos?"));
    const patch = await system.distill();

    expect(patch.phrases).toContain("bora la");
    expect(patches).toHaveLength(1);
    expect(bot.systemPrompt).toContain("bora la");
  });

  it("records an answer to 'who are you' as a fact", async () => {
    const { bot, system } = await learningBot({
      reply: "I am Ana's AI twin.",
    });

    await bot.handle(msg("1", "who are you?"));
    const patch = await system.distill();

    expect(patch.facts).toEqual([
      'Answers "who are you" with: I am Ana\'s AI twin.',
    ]);
  });

  it("adds a concision style guide once most ratings are bad", async () => {
    const { system } = await learningBot();

    await system.addRating("r-1", "chat-1", -1);
    await system.addRating("r-2", "chat-1", -1);
    await system.addRating("r-3", "chat-1", 1);
    const patch = await system.distill();

    expect(patch.styleGuide).toMatch(PATTERN_1);
  });

  it("does not add a style guide when ratings are mostly good", async () => {
    const { system } = await learningBot();

    await system.addRating("r-1", "chat-1", 1);
    const patch = await system.distill();

    expect(patch.styleGuide).toBeUndefined();
  });
});

describe("fine-tune dataset", () => {
  it("collects one entry per replied turn, with the prompt and history it used", async () => {
    const { bot, system } = await learningBot({ reply: "Sure thing" });

    await bot.handle(msg("1", "first"));
    await bot.handle(msg("2", "second"));
    const entries = await system.drainDataset();

    expect(entries).toHaveLength(2);
    expect(entries[0]?.completion).toBe("Sure thing");
    expect(entries[0]?.messages.at(-1)).toEqual({
      content: "first",
      role: "user",
    });
    expect(entries[1]?.messages.at(-1)).toEqual({
      content: "second",
      role: "user",
    });
    expect(entries[1]?.historyTurns).toEqual([
      { content: "first", role: "user" },
      { content: "Sure thing", role: "assistant" },
    ]);
    expect(entries[0]?.system).toContain("You are Ana.");
  });

  it("empties the pending set after a drain", async () => {
    const { bot, system } = await learningBot();
    await bot.handle(msg("1", "hello"));

    await system.drainDataset();

    expect(await system.drainDataset()).toEqual([]);
  });
});

describe("persistence", () => {
  it("saves state after a rating and reloads the same counts", async () => {
    const store = mapStore();
    const { system } = await learningBot({ store });

    await system.addRating("r-1", "chat-1", 1);
    await system.addRating("r-2", "chat-1", -1);

    const saved: unknown = JSON.parse(store.data.get("learning:state") ?? "{}");
    expect(saved).toMatchObject({ badCount: 1, goodCount: 1 });
    expect(saved).toMatchObject({ feedbackCount: 2 });

    const reloaded = await LearningSystem.create({ store });
    expect(reloaded.getState()).toMatchObject({
      badCount: 1,
      feedbackCount: 2,
      goodCount: 1,
    });
  });

  it("starts from defaults when the stored state is corrupt", async () => {
    const store = mapStore("{broken");

    const system = await LearningSystem.create({ store });

    expect(system.getState().prompt.maxWords).toBe(15);
    expect(system.getState().feedbackCount).toBe(0);
  });

  it("fills missing fields in an older stored state from the defaults", async () => {
    const store = mapStore(JSON.stringify({ goodCount: 3 }));

    const system = await LearningSystem.create({ store });

    expect(system.getState().goodCount).toBe(3);
    expect(system.getState().recall.rrfK).toBe(60);
    expect(system.getState().prompt.styleGuideStrength).toBe(1);
  });
});
