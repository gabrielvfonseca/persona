import { join } from "node:path";
import type { ReplyGenerator } from "@persona/core";
import { createMemory } from "@persona/memory";
import { describe, expect, it } from "vitest";
import { buildBot } from "../../examples/bot/src/bot";
import { parseConfig } from "../../examples/bot/src/config";
import { loadPersona } from "../../examples/bot/src/persona-file";
import { fakeChannel, silentLogger } from "../helpers/fakes";

/** A model stand-in: replies without loading anything. */
const stubGenerator: ReplyGenerator = {
  generate: () => Promise.resolve("Sure, lets go"),
};

const personaPath = join(
  import.meta.dirname,
  "../../examples/bot/data/persona.example.json"
);

const linkedEnv = {
  DATABASE_URL: "postgres://persona:persona@localhost:5432/persona",
  PERSONA_CONSENT: "true",
  PERSONA_MODEL: "qwen2.5-0.5b",
  PERSONA_NAME: "Ana",
};

describe("buildBot wiring", () => {
  const build = async (env: Record<string, string>, extra = {}) => {
    const channel = fakeChannel();
    const bot = await buildBot({
      channel,
      config: parseConfig(env),
      generator: stubGenerator,
      logger: silentLogger,
      persona: loadPersona(personaPath),
      ...extra,
    });
    return { bot, channel };
  };

  it("answers every direct message", async () => {
    const { bot, channel } = await build(linkedEnv);

    const result = await bot.handle({ chatId: "c", id: "1", text: "hello" });

    expect(result).toEqual({ kind: "replied" });
    expect(channel.sent[0]?.text).toBe("Sure, lets go");
  });

  it("lets only ADMIN_NUMBERS pause the bot", async () => {
    const env = { ...linkedEnv, ADMIN_NUMBERS: "5511999999999" };
    const { bot } = await build(env);

    await bot.handle({
      chatId: "c",
      id: "1",
      senderId: "5511000000000",
      text: "!pause",
    });
    expect(bot.state.paused).toBe(false);

    await bot.handle({
      chatId: "c",
      id: "2",
      senderId: "5511999999999",
      text: "!pause",
    });
    expect(bot.state.paused).toBe(true);
  });

  it("uses the injected memory when one is provided", async () => {
    const memory = createMemory();
    const { bot } = await build(linkedEnv, { memory });

    expect(bot.memory).toBe(memory);
  });

  it("passes learning callbacks through to the pipeline", async () => {
    const recorded: string[] = [];
    const { bot } = await build(linkedEnv, {
      learning: {
        recordOutcome: (input: { result: { kind: string } }) => {
          recorded.push(input.result.kind);
        },
      },
    });

    await bot.handle({ chatId: "c", id: "1", text: "hello" });

    expect(recorded).toEqual(["replied"]);
  });
});
