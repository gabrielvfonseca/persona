import type { Channel, Turn } from "@persona/core";
import { createMemory } from "@persona/memory";
import { parsePersona } from "@persona/schemas";
import { describe, expect, it } from "vitest";
import { createPersona } from "../src/index";

const persona = parsePersona({
  facts: [],
  name: "Ana",
  phrases: [],
  quotes: [],
  stats: { medianLen: 5, p90Len: 9 },
  styleGuide: "short",
  version: 1,
});
const silent = {
  error() {
    /* intentionally empty */
  },
  info() {
    /* intentionally empty */
  },
  warn() {
    /* intentionally empty */
  },
};

function setup(generate: (s: string, m: Turn[]) => string = () => "ok") {
  const sent: string[] = [];
  const calls: { system: string; messages: Turn[] }[] = [];
  const channel: Channel = {
    name: "t",
    send(_chatId, text) {
      sent.push(text);
      return Promise.resolve();
    },
  };
  const generator = {
    generate(system: string, messages: Turn[]) {
      calls.push({ messages, system });
      return Promise.resolve(generate(system, messages));
    },
  };
  return { calls, channel, generator, sent };
}

describe("persona pipeline behaviour", () => {
  it("lets an admin in a group pause and resume, even while paused", async () => {
    const { channel, generator, sent } = setup();
    const bot = createPersona({
      admins: ["5511"],
      channel,
      generator,
      logger: silent,
      persona,
      policy: { direct: "always", group: "always" },
    });
    const base = { chatId: "g1", isGroup: true, senderName: "x", text: "" };
    expect(
      await bot.handle({
        id: "1",
        ...base,
        senderId: "5511@s.whatsapp.net",
        text: "!pause",
      })
    ).toEqual({
      kind: "command",
    });
    expect(await bot.handle({ id: "2", ...base, text: "hey" })).toEqual({
      kind: "skipped",
      reason: "paused",
    });
    expect(
      await bot.handle({
        id: "3",
        ...base,
        senderId: "5511@s.whatsapp.net",
        text: "!resume",
      })
    ).toEqual({
      kind: "command",
    });
    expect(bot.state.paused).toBe(false);
    expect(sent).toEqual(["Bot paused.", "Bot resumed."]);
  });

  it("ignores admin commands from a group member who is not an admin", async () => {
    const { channel, generator } = setup();
    const bot = createPersona({
      admins: ["5511"],
      channel,
      generator,
      logger: silent,
      persona,
      policy: { direct: "always", group: "always" },
    });
    const r = await bot.handle({
      chatId: "g1",
      id: "1",
      isGroup: true,
      senderId: "5599@s.whatsapp.net",
      text: "!pause",
    });
    expect(r.kind).toBe("replied");
    expect(bot.state.paused).toBe(false);
  });

  it("adds recalled messages from the same chat to the system prompt", async () => {
    const { channel, generator, calls } = setup();
    const memory = createMemory();
    await memory.history.append("c1", [
      { content: "remember the blue umbrella", role: "user" },
    ]);
    const bot = createPersona({
      channel,
      generator,
      logger: silent,
      memory,
      persona,
      policy: { direct: "always" },
      recallLimit: 3,
    });
    await bot.handle({
      chatId: "c1",
      id: "1",
      text: "where is the blue umbrella?",
    });
    expect(calls[0]?.system).toContain("Earlier in this chat:");
    expect(calls[0]?.system).toContain("remember the blue umbrella");
  });

  it("keeps the persona system prompt on every model call", async () => {
    const { channel, generator, calls } = setup();
    const bot = createPersona({
      channel,
      generator,
      logger: silent,
      persona,
      policy: { direct: "always" },
    });
    await bot.handle({ chatId: "c1", id: "1", text: "hello" });
    expect(calls[0]?.system).toBe(bot.systemPrompt);
    expect(calls[0]?.system).toContain("You are Ana.");
  });
});
