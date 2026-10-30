import type { Channel, IncomingMessage, Turn } from "@persona/core";
import { createPersona } from "@persona/persona";
import { parsePersona } from "@persona/schemas";
import { describe, expect, it, vi } from "vitest";
import persona from "../data/persona.example.json";
import { buildBot } from "../src/bot";
import { parseConfig } from "../src/config";

// Keep the transport test offline: the real adapter would call OpenRouter.
vi.mock("../src/model", () => ({
  openRouterGenerator: () => ({ generate: async () => "ok" }),
  openRouterDescriber: () => ({ describe: async () => "" }),
}));

const ADMIN = "5511999999999";
const env = {
  PERSONA_CONSENT: "true",
  PERSONA_NAME: "Ana",
  PERSONA_MODEL: "m",
  OPENROUTER_API_KEY: "k",
  ADMIN_NUMBERS: ADMIN,
};

function fakeChannel() {
  const sent: { chatId: string; text: string }[] = [];
  const channel: Channel = {
    name: "test",
    async send(chatId, text) {
      sent.push({ chatId, text });
    },
  };
  return { channel, sent };
}

function fakeGenerator() {
  const calls: { system: string; messages: Turn[] }[] = [];
  return {
    calls,
    generator: {
      async generate(system: string, messages: Turn[]) {
        calls.push({ system, messages });
        return `reply ${calls.length}`;
      },
    },
  };
}

const msg = (over: Partial<IncomingMessage>): IncomingMessage => ({
  id: crypto.randomUUID(),
  chatId: "dm-1",
  text: "hi",
  ...over,
});

describe("example persona bot", () => {
  it("answers a five-turn direct conversation and keeps history", async () => {
    const { channel, sent } = fakeChannel();
    const { calls, generator } = fakeGenerator();
    const bot = createPersona({
      persona: parsePersona(persona),
      channel,
      generator,
      policy: { direct: "always" },
      logger: { info() {}, warn() {}, error() {} },
    });

    for (let i = 1; i <= 5; i++) {
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
      persona: parsePersona(persona),
      channel,
      generator,
      logger: { info() {}, warn() {}, error() {} },
    });

    const quiet = await bot.handle(
      msg({ isGroup: true, senderName: "Bia", text: "anyone?" }),
    );
    expect(quiet).toEqual({ kind: "skipped", reason: "not-addressed" });

    const named = await bot.handle(
      msg({
        isGroup: true,
        senderName: "Bia",
        text: "Ana, você vem?",
        chatId: "g-1",
      }),
    );
    expect(named.kind).toBe("replied");
    expect(sent.at(-1)?.chatId).toBe("g-1");
  });

  it("lets an admin pause and resume, and ignores the same command from others", async () => {
    const { channel, sent } = fakeChannel();
    const { generator } = fakeGenerator();
    const bot = createPersona({
      persona: parsePersona(persona),
      channel,
      generator,
      admins: [ADMIN],
      policy: { direct: "always" },
      logger: { info() {}, warn() {}, error() {} },
    });

    const stranger = await bot.handle(
      msg({ text: "!pause", chatId: "5500000000000@s.whatsapp.net" }),
    );
    expect(stranger.kind).toBe("replied");

    const admin = `${ADMIN}@s.whatsapp.net`;
    expect(
      (await bot.handle(msg({ text: "!pause", chatId: admin }))).kind,
    ).toBe("command");
    expect(bot.state.paused).toBe(true);
    expect(await bot.handle(msg({ text: "hello", chatId: "dm-2" }))).toEqual({
      kind: "skipped",
      reason: "paused",
    });

    expect(
      (await bot.handle(msg({ text: "!resume", chatId: admin }))).kind,
    ).toBe("command");
    expect(bot.state.paused).toBe(false);
    expect(sent.at(-1)?.text).toBe("Bot resumed.");
  });

  it("answers every direct chat on a linked device but only addressed ones on the Cloud API", async () => {
    const { channel } = fakeChannel();
    const logger = { info() {}, warn() {}, error() {} };
    const linked = buildBot({
      config: parseConfig(env, "linked-device"),
      persona: parsePersona(persona),
      channel,
      transport: "linked-device",
      logger,
    });
    const cloud = buildBot({
      config: parseConfig(
        {
          ...env,
          WHATSAPP_ACCESS_TOKEN: "a",
          WHATSAPP_APP_SECRET: "b",
          WHATSAPP_PHONE_NUMBER_ID: "1",
          WHATSAPP_VERIFY_TOKEN: "v",
          ADMIN_KEY: "k",
        },
        "cloud-api",
      ),
      persona: parsePersona(persona),
      channel,
      transport: "cloud-api",
      logger,
    });

    expect((await linked.handle(msg({ text: "oi" }))).kind).toBe("replied");
    expect(await cloud.handle(msg({ text: "oi" }))).toEqual({
      kind: "skipped",
      reason: "not-addressed",
    });
  });
});
