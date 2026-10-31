import type { Channel, IncomingMessage, Turn } from "@persona/core";
import { createPersona } from "@persona/persona";
import { parsePersona } from "@persona/schemas";
import { describe, expect, it } from "vitest";
import persona from "../data/persona.example.json";
import { buildBot } from "../src/bot";
import { parseConfig } from "../src/config";

/** A model stand-in for buildBot: replies "ok" without loading anything. */
const stubGenerator = { generate: () => Promise.resolve("ok") };

const ADMIN = "5511999999999";
const env = {
  ADMIN_NUMBERS: ADMIN,
  DATABASE_URL: "postgres://persona:persona@localhost:5432/persona",
  PERSONA_CONSENT: "true",
  PERSONA_MODEL: "qwen2.5-0.5b",
  PERSONA_NAME: "Ana",
};

function fakeChannel() {
  const sent: { chatId: string; text: string }[] = [];
  const channel: Channel = {
    name: "test",
    send(chatId, text) {
      sent.push({ chatId, text });
      return Promise.resolve();
    },
  };
  return { channel, sent };
}

function fakeGenerator() {
  const calls: { system: string; messages: Turn[] }[] = [];
  return {
    calls,
    generator: {
      generate(system: string, messages: Turn[]) {
        calls.push({ messages, system });
        return Promise.resolve(`reply ${calls.length}`);
      },
    },
  };
}

const msg = (over: Partial<IncomingMessage>): IncomingMessage => ({
  chatId: "dm-1",
  id: crypto.randomUUID(),
  text: "hi",
  ...over,
});

describe("example persona bot", () => {
  it("answers a five-turn direct conversation and keeps history", async () => {
    const { channel, sent } = fakeChannel();
    const { calls, generator } = fakeGenerator();
    const bot = createPersona({
      channel,
      generator,
      logger: {
        error() {
          /* intentionally empty */
        },
        info() {
          /* intentionally empty */
        },
        warn() {
          /* intentionally empty */
        },
      },
      persona: parsePersona(persona),
      policy: { direct: "always" },
    });

    for (let i = 1; i <= 5; i += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: messages must be handled in the order they arrive
      const result = await bot.handle(msg({ text: `message ${i}` }));
      expect(result.kind).toBe("replied");
    }

    expect(sent).toHaveLength(5);
    expect(sent[4]?.text).toBe("reply 5");
    expect(bot.systemPrompt).toContain("You are Ana.");
    expect(calls[0]?.system).toContain("You are Ana.");
    // The fifth call sees four earlier exchanges (8 turns) plus the new message.
    expect(calls[4]?.messages).toHaveLength(9);
  });

  it("stays quiet in groups unless it is addressed by name", async () => {
    const { channel, sent } = fakeChannel();
    const { generator } = fakeGenerator();
    const bot = createPersona({
      channel,
      generator,
      logger: {
        error() {
          /* intentionally empty */
        },
        info() {
          /* intentionally empty */
        },
        warn() {
          /* intentionally empty */
        },
      },
      persona: parsePersona(persona),
    });

    const quiet = await bot.handle(
      msg({ isGroup: true, senderName: "Bia", text: "anyone?" })
    );
    expect(quiet).toEqual({ kind: "skipped", reason: "not-addressed" });

    const named = await bot.handle(
      msg({
        chatId: "g-1",
        isGroup: true,
        senderName: "Bia",
        text: "Ana, você vem?",
      })
    );
    expect(named.kind).toBe("replied");
    expect(sent.at(-1)?.chatId).toBe("g-1");
  });

  it("lets an admin pause and resume, and ignores the same command from others", async () => {
    const { channel, sent } = fakeChannel();
    const { generator } = fakeGenerator();
    const bot = createPersona({
      admins: [ADMIN],
      channel,
      generator,
      logger: {
        error() {
          /* intentionally empty */
        },
        info() {
          /* intentionally empty */
        },
        warn() {
          /* intentionally empty */
        },
      },
      persona: parsePersona(persona),
      policy: { direct: "always" },
    });

    const stranger = await bot.handle(
      msg({ chatId: "5500000000000@s.whatsapp.net", text: "!pause" })
    );
    expect(stranger.kind).toBe("replied");

    const admin = `${ADMIN}@s.whatsapp.net`;
    expect(
      (await bot.handle(msg({ chatId: admin, text: "!pause" }))).kind
    ).toBe("command");
    expect(bot.state.paused).toBe(true);
    expect(await bot.handle(msg({ chatId: "dm-2", text: "hello" }))).toEqual({
      kind: "skipped",
      reason: "paused",
    });

    expect(
      (await bot.handle(msg({ chatId: admin, text: "!resume" }))).kind
    ).toBe("command");
    expect(bot.state.paused).toBe(false);
    expect(sent.at(-1)?.text).toBe("Bot resumed.");
  });

  it("answers every direct chat", async () => {
    const { channel } = fakeChannel();
    const bot = await buildBot({
      channel,
      config: parseConfig(env),
      generator: stubGenerator,
      logger: {
        error() {
          /* intentionally empty */
        },
        info() {
          /* intentionally empty */
        },
        warn() {
          /* intentionally empty */
        },
      },
      persona: parsePersona(persona),
    });

    expect((await bot.handle(msg({ text: "oi" }))).kind).toBe("replied");
  });
});
