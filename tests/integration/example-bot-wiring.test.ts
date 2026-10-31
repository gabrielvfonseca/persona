import { join } from "node:path";
import { createMemory } from "@persona/memory";
import { describe, expect, it, vi } from "vitest";
import { buildBot, type Transport } from "../../examples/bot/src/bot";
import { parseConfig } from "../../examples/bot/src/config";
import { loadPersona } from "../../examples/bot/src/persona-file";
import { fakeChannel, silentLogger } from "../helpers/fakes";

const embed = vi.fn(async (texts: readonly string[]) =>
  texts.map(() => [1, 0]),
);

// The example model adapters call OpenRouter. Replace them so the wiring can be
// tested without a network or an API key.
vi.mock("../../examples/bot/src/model", () => ({
  openRouterGenerator: () => ({
    generate: async () => "Sure, lets go",
  }),
  openRouterDescriber: () => ({
    describe: async () => "a sunset",
  }),
  openRouterEmbedder: () => ({
    embed: (texts: readonly string[]) => embed(texts),
  }),
}));

const personaPath = join(
  import.meta.dirname,
  "../../examples/bot/data/persona.example.json",
);

const linkedEnv = {
  PERSONA_CONSENT: "true",
  PERSONA_NAME: "Ana",
  PERSONA_MODEL: "openai/gpt-4o-mini",
  OPENROUTER_API_KEY: "sk-test",
};

const cloudEnv = {
  ...linkedEnv,
  WHATSAPP_ACCESS_TOKEN: "token",
  WHATSAPP_APP_SECRET: "secret",
  WHATSAPP_PHONE_NUMBER_ID: "PHONE_1",
  WHATSAPP_VERIFY_TOKEN: "verify",
  ADMIN_KEY: "admin-pass",
};

describe("buildBot wiring by transport", () => {
  const build = (
    transport: Transport,
    env: Record<string, string>,
    extra = {},
  ) => {
    const config =
      transport === "linked-device"
        ? parseConfig(env, "linked-device")
        : parseConfig(env, "cloud-api");
    const channel = fakeChannel();
    const persona = loadPersona(personaPath);
    const bot = buildBot({
      config,
      persona,
      channel,
      transport,
      logger: silentLogger,
      ...extra,
    });
    return { bot, channel };
  };

  it("answers every direct message on a linked device", async () => {
    const { bot, channel } = build("linked-device", linkedEnv);

    const result = await bot.handle({ id: "1", chatId: "c", text: "hello" });

    expect(result).toEqual({ kind: "replied" });
    expect(channel.sent[0]?.text).toBe("Sure, lets go");
  });

  it("answers direct messages on the Cloud API only when addressed", async () => {
    const { bot } = build("cloud-api", cloudEnv);

    const result = await bot.handle({ id: "1", chatId: "c", text: "hello" });
    const addressed = await bot.handle({
      id: "2",
      chatId: "c",
      text: "Ana, are you there?",
    });

    expect(result).toEqual({ kind: "skipped", reason: "not-addressed" });
    expect(addressed).toEqual({ kind: "replied" });
  });

  it("lets only ADMIN_NUMBERS pause the bot", async () => {
    const env = { ...linkedEnv, ADMIN_NUMBERS: "5511999999999" };
    const { bot } = build("linked-device", env);

    await bot.handle({
      id: "1",
      chatId: "c",
      text: "!pause",
      senderId: "5511000000000",
    });
    expect(bot.state.paused).toBe(false);

    await bot.handle({
      id: "2",
      chatId: "c",
      text: "!pause",
      senderId: "5511999999999",
    });
    expect(bot.state.paused).toBe(true);
  });

  it("uses the embedder only when EMBEDDING_MODEL is set", async () => {
    embed.mockClear();
    const { bot } = build("linked-device", {
      ...linkedEnv,
      EMBEDDING_MODEL: "openai/text-embedding-3-small",
      RECALL_LIMIT: "2",
    });

    await bot.memory.learn("The bakery opens at 7am.");
    await bot.handle({
      id: "1",
      chatId: "c",
      text: "when does the bakery open?",
    });

    expect(embed).toHaveBeenCalled();
  });

  it("uses the injected memory when one is provided", () => {
    const memory = createMemory();
    const { bot } = build("linked-device", linkedEnv, { memory });

    expect(bot.memory).toBe(memory);
  });

  it("passes learning callbacks through to the pipeline", async () => {
    const recorded: string[] = [];
    const { bot } = build("linked-device", linkedEnv, {
      learning: {
        recordOutcome: (input: { result: { kind: string } }) => {
          recorded.push(input.result.kind);
        },
      },
    });

    await bot.handle({ id: "1", chatId: "c", text: "hello" });

    expect(recorded).toEqual(["replied"]);
  });
});
