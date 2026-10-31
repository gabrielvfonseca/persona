import type { IncomingMessage, Turn } from "@persona/core";
import { createMemory, KNOWLEDGE_CHAT } from "@persona/memory";
import { createPersona } from "@persona/persona";
import { describe, expect, it } from "vitest";
import {
  fakeChannel,
  fakeDescriber,
  fakeGenerator,
  persona,
  silentLogger,
} from "../helpers/fakes";

const msg = (over: Partial<IncomingMessage> = {}): IncomingMessage => ({
  id: "m-1",
  chatId: "chat-1",
  text: "hi there",
  ...over,
});

type BuildOptions = Partial<Parameters<typeof createPersona>[0]> & {
  /** Shorthand for a fake generator that always replies with this text. */
  reply?: string | ((turns: Turn[]) => string);
};

function build(opts: BuildOptions = {}) {
  const { reply, ...rest } = opts;
  // Typed as the fakes so tests can read .sent and .calls without casts.
  const channel = (rest.channel ?? fakeChannel()) as ReturnType<
    typeof fakeChannel
  >;
  const generator = (rest.generator ??
    fakeGenerator(reply ?? "Sure thing")) as ReturnType<typeof fakeGenerator>;
  const bot = createPersona({
    logger: silentLogger,
    ...rest,
    persona: rest.persona ?? persona(),
    channel,
    generator,
  });
  return { bot, channel, generator };
}

describe("createPersona: reply pipeline", () => {
  it("replies to a direct message and sends it to the channel", async () => {
    const { bot, channel, generator } = build({
      policy: { direct: "always" },
    });

    const result = await bot.handle(msg());

    expect(result).toEqual({ kind: "replied" });
    expect(generator.calls).toHaveLength(1);
    expect(channel.sent).toEqual([
      { chatId: "chat-1", text: "Sure thing", replyTo: "m-1" },
    ]);
  });

  it("ignores a group message that does not address the persona", async () => {
    const { bot, generator } = build();

    const result = await bot.handle(
      msg({ isGroup: true, senderName: "Bia", text: "anyone up for lunch?" }),
    );

    expect(result).toEqual({ kind: "skipped", reason: "not-addressed" });
    expect(generator.calls).toHaveLength(0);
  });

  it("replies in a group when the persona is named, prefixing the user turn with the sender", async () => {
    const { bot, generator } = build();

    const result = await bot.handle(
      msg({
        isGroup: true,
        senderName: "Bia",
        text: "Ana, what do you think?",
      }),
    );

    expect(result.kind).toBe("replied");
    const last = generator.calls[0]?.messages.at(-1);
    expect(last).toEqual({
      role: "user",
      content: "Bia: Ana, what do you think?",
    });
  });

  it("replies to a bot mention even when the name is absent", async () => {
    const { bot } = build();

    const result = await bot.handle(
      msg({
        isGroup: true,
        senderName: "Bia",
        text: "hey you",
        mentionsBot: true,
      }),
    );

    expect(result.kind).toBe("replied");
  });

  it("strips a speaker prefix and keeps only the first sentence", async () => {
    const { bot, channel } = build({
      policy: { direct: "always" },
      reply: "Ana: Sure thing. Then more text follows here.",
    });

    await bot.handle(msg());

    expect(channel.sent[0]?.text).toBe("Sure thing.");
  });

  it("sends earlier turns back to the model on the next message", async () => {
    const { bot, generator } = build({ policy: { direct: "always" } });

    await bot.handle(msg({ id: "a", text: "first question" }));
    await bot.handle(msg({ id: "b", text: "second question" }));

    const second = generator.calls[1]?.messages ?? [];
    expect(second.map((t) => t.role)).toEqual(["user", "assistant", "user"]);
    expect(second[0]?.content).toBe("first question");
    expect(second[2]?.content).toBe("second question");
  });

  it("adds recalled memory to the system prompt when recallLimit is set", async () => {
    const memory = createMemory();
    await memory.learn("The office closes at 6pm on Fridays.");
    const { bot, generator } = build({
      policy: { direct: "always" },
      memory,
      recallLimit: 3,
    });

    await bot.handle(msg({ text: "when does the office close on friday?" }));

    const system = generator.calls[0]?.system ?? "";
    expect(system).toContain("Earlier in this chat:");
    expect(system).toContain("The office closes at 6pm on Fridays.");
  });

  it("leaves the system prompt alone when recall is off", async () => {
    const memory = createMemory();
    await memory.learn("The office closes at 6pm on Fridays.");
    const { bot, generator } = build({ policy: { direct: "always" }, memory });

    await bot.handle(msg({ text: "when does the office close on friday?" }));

    expect(generator.calls[0]?.system).not.toContain("Earlier in this chat:");
  });

  it("skips a duplicate message id", async () => {
    const memory = createMemory();
    const { bot, generator } = build({ policy: { direct: "always" }, memory });

    await bot.handle(msg({ id: "dup" }));
    const second = await bot.handle(msg({ id: "dup" }));

    expect(second).toEqual({ kind: "skipped", reason: "duplicate" });
    expect(generator.calls).toHaveLength(1);
  });

  it("rate limits per chat and counts every model call", async () => {
    const memory = createMemory({ maxPerWindow: 2 });
    const { bot } = build({ policy: { direct: "always" }, memory });

    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(await bot.handle(msg({ id: `r-${i}`, text: `q${i}` })));
    }

    expect(results.map((r) => r.kind)).toEqual([
      "replied",
      "replied",
      "skipped",
    ]);
    expect(results[2]).toEqual({ kind: "skipped", reason: "rate-limited" });
  });

  it("does not let one chat use up another chat's limit", async () => {
    const memory = createMemory({ maxPerWindow: 1 });
    const { bot } = build({ policy: { direct: "always" }, memory });

    const a = await bot.handle(msg({ id: "a", chatId: "chat-a" }));
    const b = await bot.handle(msg({ id: "b", chatId: "chat-b" }));

    expect(a.kind).toBe("replied");
    expect(b.kind).toBe("replied");
  });

  it("drops a reply that repeats a persona quote", async () => {
    // No sentence punctuation, so firstSentence keeps the whole quote for the guard.
    const quote = "tudo bem por aqui agora mesmo";
    const base = persona();
    const { bot, channel } = build({
      policy: { direct: "always" },
      persona: { ...base, quotes: [quote] },
      reply: `Well, ${quote} and that is that`,
    });

    const result = await bot.handle(msg());

    expect(result).toEqual({ kind: "skipped", reason: "guard" });
    expect(channel.sent).toHaveLength(0);
  });

  it("skips an empty reply", async () => {
    const { bot, channel } = build({
      policy: { direct: "always" },
      reply: "   ",
    });

    const result = await bot.handle(msg());

    expect(result).toEqual({ kind: "skipped", reason: "empty" });
    expect(channel.sent).toHaveLength(0);
  });

  it("returns failed when generation throws and does not store history", async () => {
    const memory = createMemory();
    const generator = {
      async generate(): Promise<string> {
        throw new Error("model down");
      },
    };
    const { bot } = build({ policy: { direct: "always" }, memory, generator });

    const result = await bot.handle(msg());

    expect(result.kind).toBe("failed");
    expect(await memory.history.load("chat-1")).toEqual([]);
  });

  it("returns failed when sending throws and does not store history", async () => {
    const memory = createMemory();
    const { bot } = build({
      policy: { direct: "always" },
      memory,
      channel: fakeChannel({ fail: true }),
    });

    const result = await bot.handle(msg());

    expect(result.kind).toBe("failed");
    expect(await memory.history.load("chat-1")).toEqual([]);
  });

  it("never throws, even when the channel fails", async () => {
    const { bot } = build({
      policy: { direct: "always" },
      channel: fakeChannel({ fail: true }),
    });

    await expect(bot.handle(msg())).resolves.toMatchObject({ kind: "failed" });
  });

  it("describes attached images and passes the description to the model", async () => {
    const describer = fakeDescriber("a red bike");
    const { bot, generator } = build({
      policy: { direct: "always" },
      describer,
    });

    await bot.handle(
      msg({
        media: [
          {
            kind: "image",
            data: new Uint8Array([1, 2, 3]),
            mime: "image/jpeg",
          },
        ],
      }),
    );

    expect(describer.seen).toEqual([{ bytes: 3, mime: "image/jpeg" }]);
    expect(generator.calls[0]?.messages.at(-1)?.content).toBe(
      "hi there [image: a red bike]",
    );
  });

  it("marks media as unavailable when the describer fails", async () => {
    const describer = {
      async describe(): Promise<string> {
        throw new Error("vision down");
      },
    };
    const { bot, generator } = build({
      policy: { direct: "always" },
      describer,
    });

    await bot.handle(
      msg({
        text: "",
        media: [
          { kind: "sticker", data: new Uint8Array([1]), mime: "image/webp" },
        ],
      }),
    );

    expect(generator.calls[0]?.messages.at(-1)?.content).toBe(
      " [sticker: unavailable]",
    );
  });
});

describe("createPersona: admin commands and pause", () => {
  const admin = "5511999999999";

  it("answers !whois for anyone", async () => {
    const { bot, channel, generator } = build({ policy: { direct: "always" } });

    const result = await bot.handle(
      msg({ text: "!whois", senderId: "stranger" }),
    );

    expect(result).toEqual({ kind: "command" });
    expect(channel.sent[0]?.text).toContain("Ana");
    expect(generator.calls).toHaveLength(0);
  });

  it("lets an admin pause, blocks replies while paused, and resumes", async () => {
    const { bot, channel, generator } = build({
      policy: { direct: "always" },
      admins: [admin],
    });

    await bot.handle(msg({ id: "1", text: "!pause", senderId: admin }));
    expect(bot.state.paused).toBe(true);

    const paused = await bot.handle(msg({ id: "2", text: "are you there?" }));
    expect(paused).toEqual({ kind: "skipped", reason: "paused" });

    await bot.handle(msg({ id: "3", text: "!resume", senderId: admin }));
    expect(bot.state.paused).toBe(false);

    const after = await bot.handle(msg({ id: "4", text: "back again" }));
    expect(after.kind).toBe("replied");
    expect(generator.calls).toHaveLength(1);
    expect(channel.sent.map((s) => s.text)).toContain("Bot paused.");
  });

  it("ignores !pause from a non-admin, so the message goes through the policy", async () => {
    const { bot, generator } = build({
      policy: { direct: "always" },
      admins: [admin],
    });

    const result = await bot.handle(
      msg({ text: "!pause", senderId: "stranger" }),
    );

    expect(bot.state.paused).toBe(false);
    expect(result.kind).toBe("replied");
    expect(generator.calls).toHaveLength(1);
  });

  it("lets an admin resume even while paused, because commands run first", async () => {
    const { bot } = build({ policy: { direct: "always" }, admins: [admin] });
    bot.state.setPaused(true);

    const result = await bot.handle(msg({ text: "!resume", senderId: admin }));

    expect(result).toEqual({ kind: "command" });
    expect(bot.state.paused).toBe(false);
  });

  it("runs !learn commands without calling the model", async () => {
    const { bot, generator } = build({
      policy: { direct: "always" },
      admins: [admin],
    });

    const result = await bot.handle(
      msg({ text: "!learn she likes green tea", senderId: admin }),
    );

    expect(result).toEqual({ kind: "command" });
    expect(generator.calls).toHaveLength(0);
  });
});

describe("createPersona: prompt, patches and weights", () => {
  it("builds a system prompt that names the persona and carries its facts", () => {
    const { bot } = build();

    expect(bot.systemPrompt).toContain("You are Ana.");
    expect(bot.systemPrompt).toContain("Lives in São Paulo.");
    expect(bot.systemPrompt).toContain("Reply in at most 15 words.");
  });

  it("applies a persona patch and rebuilds the prompt without duplicates", () => {
    const { bot } = build();
    const before = bot.systemPrompt;

    bot.applyPatch({ facts: ["Works as a nurse", "lives in são paulo."] });

    expect(bot.systemPrompt).toContain("Works as a nurse");
    expect(bot.systemPrompt).not.toBe(before);
    const matches = bot.systemPrompt.match(/lives in são paulo/gi) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("calls onPatch with the patch it was given", () => {
    const seen: unknown[] = [];
    const { bot } = build({ onPatch: (p) => void seen.push(p) });

    bot.applyPatch({ phrases: ["bora"] });

    expect(seen).toEqual([{ phrases: ["bora"] }]);
  });

  it("uses new prompt weights on the next model call", async () => {
    const { bot, generator } = build({ policy: { direct: "always" } });

    bot.setPromptWeights({
      maxWords: 4,
      exampleBoost: 1,
      styleGuideStrength: 1,
      extraRules: ["Never use emoji."],
    });
    await bot.handle(msg());

    expect(generator.calls[0]?.system).toContain("Reply in at most 4 words.");
    expect(generator.calls[0]?.system).toContain("Never use emoji.");
  });

  it("notifies setRecallWeights and applies them to the memory", () => {
    const seen: unknown[] = [];
    const { bot } = build({ setRecallWeights: (w) => void seen.push(w) });
    const weights = { keywordWeight: 2, semanticWeight: 0.5, rrfK: 30 };

    bot.setRecallWeights(weights);

    expect(seen).toEqual([weights]);
  });
});

describe("createPersona: memory wiring", () => {
  it("keeps shared knowledge out of the history store", async () => {
    const memory = createMemory();
    await memory.learn("The bakery opens at 7am.");
    const { bot } = build({ policy: { direct: "always" }, memory });

    await bot.handle(msg());

    const stored = memory.nodes.recent("chat-1", 10);
    expect(stored.every((n) => n.chatId === "chat-1")).toBe(true);
    expect(memory.nodes.recent(KNOWLEDGE_CHAT, 10)).toHaveLength(1);
  });
});
