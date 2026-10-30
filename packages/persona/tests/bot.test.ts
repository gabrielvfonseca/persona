import { createCommands, createReplyPolicy } from "@persona/policy";
import { describe, expect, it, vi } from "vitest";
import { createPersonaBot } from "../src/pipeline";

/** The real command set, with only `handle` replaced by a fixed result. */
function stubCommands(result: { handled: boolean; reply?: string }) {
  const real = createCommands({
    adminNumbers: [],
    botName: "Ana",
    state: { paused: false, setPaused() {} },
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
      load: vi.fn().mockResolvedValue([]),
      append: vi.fn().mockResolvedValue(undefined),
    };
    const generator = {
      generate: vi.fn().mockResolvedValue("Hello!"),
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const policy = createReplyPolicy({ direct: "always", group: "always" });
    return { channel, history, generator, logger, policy };
  };

  it("creates bot with options", () => {
    const mocks = createMocks();
    const bot = createPersonaBot({
      channel: mocks.channel,
      history: mocks.history,
      generator: mocks.generator,
      policy: mocks.policy,
      logger: mocks.logger,
    });
    expect(bot.handle).toBeDefined();
    expect(bot.state).toBeDefined();
  });

  it("replies to message when triggered", async () => {
    const mocks = createMocks();
    const bot = createPersonaBot({
      channel: mocks.channel,
      history: mocks.history,
      generator: mocks.generator,
      policy: mocks.policy,
      logger: mocks.logger,
    });
    const result = await bot.handle({
      id: "msg1",
      chatId: "chat1",
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
      history: mocks.history,
      dedupe,
      generator: mocks.generator,
      policy: mocks.policy,
      logger: mocks.logger,
    });
    const result = await bot.handle({
      id: "msg1",
      chatId: "chat1",
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
      history: mocks.history,
      dedupe,
      generator: mocks.generator,
      policy: mocks.policy,
      logger: mocks.logger,
    });
    await bot.handle({
      id: "msg1",
      chatId: "chat1",
      text: "hello",
    });
    expect(dedupe.set).toHaveBeenCalledWith("test:msg1", 300_000);
  });

  it("skips when paused", async () => {
    const mocks = createMocks();
    const state = { paused: true, setPaused: vi.fn() };
    const bot = createPersonaBot({
      channel: mocks.channel,
      history: mocks.history,
      state,
      generator: mocks.generator,
      policy: mocks.policy,
      logger: mocks.logger,
    });
    const result = await bot.handle({
      id: "msg1",
      chatId: "chat1",
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
      history: mocks.history,
      generator: mocks.generator,
      policy,
      logger: mocks.logger,
    });
    const result = await bot.handle({
      id: "msg1",
      chatId: "chat1",
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
      history: mocks.history,
      generator: mocks.generator,
      policy: mocks.policy,
      logger: mocks.logger,
      commands,
    });
    const result = await bot.handle({
      id: "msg1",
      chatId: "chat1",
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
      history: mocks.history,
      generator: mocks.generator,
      policy: mocks.policy,
      logger: mocks.logger,
      commands,
    });
    const result = await bot.handle({
      id: "msg1",
      chatId: "chat1",
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
      history: mocks.history,
      generator: mocks.generator,
      policy: mocks.policy,
      logger: mocks.logger,
      commands,
    });
    const result = await bot.handle({
      id: "msg1",
      chatId: "chat1",
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
      history: mocks.history,
      rateLimiter,
      generator: mocks.generator,
      policy: mocks.policy,
      logger: mocks.logger,
    });
    const result = await bot.handle({
      id: "msg1",
      chatId: "chat1",
      text: "hello",
    });
    expect(result.kind).toBe("skipped");
    expect(result).toMatchObject({ kind: "skipped", reason: "rate-limited" });
  });

  it("includes sender name in group messages", async () => {
    const mocks = createMocks();
    const bot = createPersonaBot({
      channel: mocks.channel,
      history: mocks.history,
      generator: mocks.generator,
      policy: mocks.policy,
      logger: mocks.logger,
    });
    await bot.handle({
      id: "msg1",
      chatId: "group1",
      text: "hello",
      isGroup: true,
      senderName: "Alice",
    });
    expect(mocks.generator.generate).toHaveBeenCalled();
    const callArgs = mocks.generator.generate.mock.calls[0];
    expect(callArgs?.[1]?.[0]?.content).toBe("Alice: hello");
  });

  it("handles media with describer", async () => {
    const mocks = createMocks();
    const describer = {
      describe: vi.fn().mockResolvedValue("a cat photo"),
    };
    const bot = createPersonaBot({
      channel: mocks.channel,
      history: mocks.history,
      describer,
      generator: mocks.generator,
      policy: mocks.policy,
      logger: mocks.logger,
    });
    await bot.handle({
      id: "msg1",
      chatId: "chat1",
      text: "look",
      media: [
        { kind: "image", data: new Uint8Array([1, 2]), mime: "image/png" },
      ],
    });
    expect(describer.describe).toHaveBeenCalled();
    const callArgs = mocks.generator.generate.mock.calls[0];
    expect(callArgs?.[1]?.[0]?.content).toContain("[image: a cat photo]");
  });

  it("handles media description failure", async () => {
    const mocks = createMocks();
    const describer = {
      describe: vi.fn().mockRejectedValue(new Error("fail")),
    };
    const bot = createPersonaBot({
      channel: mocks.channel,
      history: mocks.history,
      describer,
      generator: mocks.generator,
      policy: mocks.policy,
      logger: mocks.logger,
    });
    await bot.handle({
      id: "msg1",
      chatId: "chat1",
      text: "look",
      media: [
        { kind: "image", data: new Uint8Array([1, 2]), mime: "image/png" },
      ],
    });
    const callArgs = mocks.generator.generate.mock.calls[0];
    expect(callArgs?.[1]?.[0]?.content).toContain("[image: unavailable]");
  });

  it("returns failed if generator fails", async () => {
    const mocks = createMocks();
    mocks.generator.generate.mockRejectedValue(new Error("api error"));
    const bot = createPersonaBot({
      channel: mocks.channel,
      history: mocks.history,
      generator: mocks.generator,
      policy: mocks.policy,
      logger: mocks.logger,
    });
    const result = await bot.handle({
      id: "msg1",
      chatId: "chat1",
      text: "hello",
    });
    expect(result.kind).toBe("failed");
  });

  it("skips if reply is empty", async () => {
    const mocks = createMocks();
    mocks.generator.generate.mockResolvedValue("   ");
    const bot = createPersonaBot({
      channel: mocks.channel,
      history: mocks.history,
      generator: mocks.generator,
      policy: mocks.policy,
      logger: mocks.logger,
    });
    const result = await bot.handle({
      id: "msg1",
      chatId: "chat1",
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
      history: mocks.history,
      generator: mocks.generator,
      policy: mocks.policy,
      logger: mocks.logger,
    });
    const result = await bot.handle({
      id: "msg1",
      chatId: "chat1",
      text: "hello",
    });
    expect(result.kind).toBe("failed");
  });

  it("loads history and appends turns", async () => {
    const mocks = createMocks();
    mocks.history.load.mockResolvedValue([
      { role: "user", content: "previous" },
      { role: "assistant", content: "response" },
    ]);
    const bot = createPersonaBot({
      channel: mocks.channel,
      history: mocks.history,
      generator: mocks.generator,
      policy: mocks.policy,
      logger: mocks.logger,
    });
    await bot.handle({
      id: "msg1",
      chatId: "chat1",
      text: "hello",
    });
    expect(mocks.history.load).toHaveBeenCalledWith("chat1");
    expect(mocks.history.append).toHaveBeenCalledWith("chat1", [
      { role: "user", content: "hello" },
      { role: "assistant", content: "Hello!" },
    ]);
  });
});
