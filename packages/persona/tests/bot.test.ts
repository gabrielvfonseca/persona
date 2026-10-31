import { createCommands, createReplyPolicy } from "@persona/policy";
import { describe, expect, it, vi } from "vitest";
import { createPersonaBot } from "../src/pipeline";

/** The real command set, with only `handle` replaced by a fixed result. */
function stubCommands(result: { handled: boolean; reply?: string }) {
  const real = createCommands({
    adminNumbers: [],
    botName: "Ana",
    state: {
      paused: false,
      setPaused() {
        /* intentionally empty */
      },
    },
  });
  return { ...real, handle: vi.fn().mockResolvedValue(result) };
}

describe("createPersonaBot", () => {
  const createMocks = () => {
    const channel = {
      name: "test",
      send: vi.fn().mockResolvedValue(undefined),
    };
    const history = {
      append: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue([]),
    };
    const generator = {
      generate: vi.fn().mockResolvedValue("Hello!"),
    };
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const policy = createReplyPolicy({ direct: "always", group: "always" });
    return { channel, generator, history, logger, policy };
  };

  it("creates bot with options", () => {
    const mocks = createMocks();
    const bot = createPersonaBot({
      channel: mocks.channel,
      generator: mocks.generator,
      history: mocks.history,
      logger: mocks.logger,
      policy: mocks.policy,
    });
    expect(bot.handle).toBeDefined();
    expect(bot.state).toBeDefined();
  });

  it("replies to message when triggered", async () => {
    const mocks = createMocks();
    const bot = createPersonaBot({
      channel: mocks.channel,
      generator: mocks.generator,
      history: mocks.history,
      logger: mocks.logger,
      policy: mocks.policy,
    });
    const result = await bot.handle({
      chatId: "chat1",
      id: "msg1",
      text: "hello",
    });
    expect(result.kind).toBe("replied");
    expect(mocks.channel.send).toHaveBeenCalledWith("chat1", "Hello!", "msg1");
    expect(mocks.history.append).toHaveBeenCalled();
  });

  it("skips duplicate messages when dedupe enabled", async () => {
    const mocks = createMocks();
    const dedupe = {
      has: vi.fn().mockResolvedValue(true),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const bot = createPersonaBot({
      channel: mocks.channel,
      dedupe,
      generator: mocks.generator,
      history: mocks.history,
      logger: mocks.logger,
      policy: mocks.policy,
    });
    const result = await bot.handle({
      chatId: "chat1",
      id: "msg1",
      text: "hello",
    });
    expect(result.kind).toBe("skipped");
    expect(result).toMatchObject({ kind: "skipped", reason: "duplicate" });
    expect(mocks.channel.send).not.toHaveBeenCalled();
  });

  it("marks dedupe after replying", async () => {
    const mocks = createMocks();
    const dedupe = {
      has: vi.fn().mockResolvedValue(false),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const bot = createPersonaBot({
      channel: mocks.channel,
      dedupe,
      generator: mocks.generator,
      history: mocks.history,
      logger: mocks.logger,
      policy: mocks.policy,
    });
    await bot.handle({
      chatId: "chat1",
      id: "msg1",
      text: "hello",
    });
    expect(dedupe.set).toHaveBeenCalledWith("test:msg1", 300_000);
  });

  it("skips when paused", async () => {
    const mocks = createMocks();
    const state = { paused: true, setPaused: vi.fn() };
    const bot = createPersonaBot({
      channel: mocks.channel,
      generator: mocks.generator,
      history: mocks.history,
      logger: mocks.logger,
      policy: mocks.policy,
      state,
    });
    const result = await bot.handle({
      chatId: "chat1",
      id: "msg1",
      text: "hello",
    });
    expect(result.kind).toBe("skipped");
    expect(result).toMatchObject({ kind: "skipped", reason: "paused" });
    expect(mocks.channel.send).not.toHaveBeenCalled();
  });

  it("skips when not addressed and policy says never", async () => {
    const mocks = createMocks();
    const policy = createReplyPolicy({ direct: "never", group: "never" });
    const bot = createPersonaBot({
      channel: mocks.channel,
      generator: mocks.generator,
      history: mocks.history,
      logger: mocks.logger,
      policy,
    });
    const result = await bot.handle({
      chatId: "chat1",
      id: "msg1",
      text: "hello",
    });
    expect(result.kind).toBe("skipped");
    expect(result).toMatchObject({ kind: "skipped", reason: "not-addressed" });
  });

  it("handles commands", async () => {
    const mocks = createMocks();
    const commands = stubCommands({ handled: true, reply: "Pong" });
    const bot = createPersonaBot({
      channel: mocks.channel,
      commands,
      generator: mocks.generator,
      history: mocks.history,
      logger: mocks.logger,
      policy: mocks.policy,
    });
    const result = await bot.handle({
      chatId: "chat1",
      id: "msg1",
      text: "!ping",
    });
    expect(result.kind).toBe("command");
    expect(mocks.channel.send).toHaveBeenCalledWith("chat1", "Pong", "msg1");
  });

  it("handles command without reply", async () => {
    const mocks = createMocks();
    const commands = stubCommands({ handled: true });
    const bot = createPersonaBot({
      channel: mocks.channel,
      commands,
      generator: mocks.generator,
      history: mocks.history,
      logger: mocks.logger,
      policy: mocks.policy,
    });
    const result = await bot.handle({
      chatId: "chat1",
      id: "msg1",
      text: "!silent",
    });
    expect(result.kind).toBe("command");
    expect(mocks.channel.send).not.toHaveBeenCalled();
  });

  it("returns failed if command send fails", async () => {
    const mocks = createMocks();
    mocks.channel.send.mockRejectedValue(new Error("send failed"));
    const commands = stubCommands({ handled: true, reply: "Pong" });
    const bot = createPersonaBot({
      channel: mocks.channel,
      commands,
      generator: mocks.generator,
      history: mocks.history,
      logger: mocks.logger,
      policy: mocks.policy,
    });
    const result = await bot.handle({
      chatId: "chat1",
      id: "msg1",
      text: "!ping",
    });
    expect(result.kind).toBe("failed");
  });

  it("skips when rate limited", async () => {
    const mocks = createMocks();
    const rateLimiter = {
      allow: vi.fn().mockResolvedValue(false),
    };
    const bot = createPersonaBot({
      channel: mocks.channel,
      generator: mocks.generator,
      history: mocks.history,
      logger: mocks.logger,
      policy: mocks.policy,
      rateLimiter,
    });
    const result = await bot.handle({
      chatId: "chat1",
      id: "msg1",
      text: "hello",
    });
    expect(result.kind).toBe("skipped");
    expect(result).toMatchObject({ kind: "skipped", reason: "rate-limited" });
  });

  it("includes sender name in group messages", async () => {
    const mocks = createMocks();
    const bot = createPersonaBot({
      channel: mocks.channel,
      generator: mocks.generator,
      history: mocks.history,
      logger: mocks.logger,
      policy: mocks.policy,
    });
    await bot.handle({
      chatId: "group1",
      id: "msg1",
      isGroup: true,
      senderName: "Alice",
      text: "hello",
    });
    expect(mocks.generator.generate).toHaveBeenCalled();
    const [callArgs] = mocks.generator.generate.mock.calls;
    expect(callArgs?.[1]?.[0]?.content).toBe("Alice: hello");
  });

  it("handles media with describer", async () => {
    const mocks = createMocks();
    const describer = {
      describe: vi.fn().mockResolvedValue("a cat photo"),
    };
    const bot = createPersonaBot({
      channel: mocks.channel,
      describer,
      generator: mocks.generator,
      history: mocks.history,
      logger: mocks.logger,
      policy: mocks.policy,
    });
    await bot.handle({
      chatId: "chat1",
      id: "msg1",
      media: [
        { data: new Uint8Array([1, 2]), kind: "image", mime: "image/png" },
      ],
      text: "look",
    });
    expect(describer.describe).toHaveBeenCalled();
    const [callArgs] = mocks.generator.generate.mock.calls;
    expect(callArgs?.[1]?.[0]?.content).toContain("[image: a cat photo]");
  });

  it("handles media description failure", async () => {
    const mocks = createMocks();
    const describer = {
      describe: vi.fn().mockRejectedValue(new Error("fail")),
    };
    const bot = createPersonaBot({
      channel: mocks.channel,
      describer,
      generator: mocks.generator,
      history: mocks.history,
      logger: mocks.logger,
      policy: mocks.policy,
    });
    await bot.handle({
      chatId: "chat1",
      id: "msg1",
      media: [
        { data: new Uint8Array([1, 2]), kind: "image", mime: "image/png" },
      ],
      text: "look",
    });
    const [callArgs] = mocks.generator.generate.mock.calls;
    expect(callArgs?.[1]?.[0]?.content).toContain("[image: unavailable]");
  });

  it("returns failed if generator fails", async () => {
    const mocks = createMocks();
    mocks.generator.generate.mockRejectedValue(new Error("api error"));
    const bot = createPersonaBot({
      channel: mocks.channel,
      generator: mocks.generator,
      history: mocks.history,
      logger: mocks.logger,
      policy: mocks.policy,
    });
    const result = await bot.handle({
      chatId: "chat1",
      id: "msg1",
      text: "hello",
    });
    expect(result.kind).toBe("failed");
  });

  it("skips if reply is empty", async () => {
    const mocks = createMocks();
    mocks.generator.generate.mockResolvedValue("   ");
    const bot = createPersonaBot({
      channel: mocks.channel,
      generator: mocks.generator,
      history: mocks.history,
      logger: mocks.logger,
      policy: mocks.policy,
    });
    const result = await bot.handle({
      chatId: "chat1",
      id: "msg1",
      text: "hello",
    });
    expect(result.kind).toBe("skipped");
    expect(result).toMatchObject({ kind: "skipped", reason: "empty" });
  });

  it("returns failed if channel send fails", async () => {
    const mocks = createMocks();
    mocks.channel.send.mockRejectedValue(new Error("send failed"));
    const bot = createPersonaBot({
      channel: mocks.channel,
      generator: mocks.generator,
      history: mocks.history,
      logger: mocks.logger,
      policy: mocks.policy,
    });
    const result = await bot.handle({
      chatId: "chat1",
      id: "msg1",
      text: "hello",
    });
    expect(result.kind).toBe("failed");
  });

  it("loads history and appends turns", async () => {
    const mocks = createMocks();
    mocks.history.load.mockResolvedValue([
      { content: "previous", role: "user" },
      { content: "response", role: "assistant" },
    ]);
    const bot = createPersonaBot({
      channel: mocks.channel,
      generator: mocks.generator,
      history: mocks.history,
      logger: mocks.logger,
      policy: mocks.policy,
    });
    await bot.handle({
      chatId: "chat1",
      id: "msg1",
      text: "hello",
    });
    expect(mocks.history.load).toHaveBeenCalledWith("chat1");
    expect(mocks.history.append).toHaveBeenCalledWith("chat1", [
      { content: "hello", role: "user" },
      { content: "Hello!", role: "assistant" },
    ]);
  });
});
