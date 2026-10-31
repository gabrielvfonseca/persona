import { describe, expect, it } from "vitest";
import type {
  BotState,
  Channel,
  DedupeStore,
  HandleResult,
  HistoryStore,
  ImageDescriber,
  IncomingMessage,
  Logger,
  RateLimiter,
  ReplyGenerator,
  Turn,
} from "../src/types";

describe("types", () => {
  it("defines Turn shape", () => {
    const turn: Turn = { content: "hello", role: "user" };
    expect(turn.role).toBe("user");
    expect(turn.content).toBe("hello");
  });

  it("defines assistant turn", () => {
    const turn: Turn = { content: "hi", role: "assistant" };
    expect(turn.role).toBe("assistant");
  });

  it("defines IncomingMessage with required fields", () => {
    const msg: IncomingMessage = {
      chatId: "chat1",
      id: "123",
      text: "hello",
    };
    expect(msg.id).toBe("123");
    expect(msg.chatId).toBe("chat1");
    expect(msg.text).toBe("hello");
  });

  it("defines IncomingMessage with optional fields", () => {
    const msg: IncomingMessage = {
      chatId: "chat1",
      id: "123",
      isGroup: true,
      mentionsBot: true,
      repliesToBot: false,
      senderName: "Alice",
      text: "hello",
    };
    expect(msg.senderName).toBe("Alice");
    expect(msg.isGroup).toBe(true);
    expect(msg.mentionsBot).toBe(true);
  });

  it("defines IncomingMessage with media", () => {
    const msg: IncomingMessage = {
      chatId: "chat1",
      id: "123",
      media: [
        { data: new Uint8Array([1, 2, 3]), kind: "image", mime: "image/png" },
      ],
      text: "photo",
    };
    expect(msg.media?.[0]?.kind).toBe("image");
    expect(msg.media?.[0]?.mime).toBe("image/png");
  });

  it("defines sticker media", () => {
    const msg: IncomingMessage = {
      chatId: "chat1",
      id: "123",
      media: [
        { data: new Uint8Array([]), kind: "sticker", mime: "image/webp" },
      ],
      text: "",
    };
    expect(msg.media?.[0]?.kind).toBe("sticker");
  });

  it("defines Channel interface", async () => {
    const channel: Channel = {
      name: "test",
      send: (chatId: string, text: string, _replyTo?: string) => {
        expect(chatId).toBe("chat1");
        expect(text).toBe("hi");
        return Promise.resolve();
      },
    };
    await channel.send("chat1", "hi");
  });

  it("defines HistoryStore interface", async () => {
    const history: HistoryStore = {
      append: (_chatId: string, _turns: Turn[]) => {
        /* intentionally empty */
        return Promise.resolve();
      },
      load: (_chatId: string) =>
        Promise.resolve([{ content: "hi", role: "user" }]),
    };
    const turns = await history.load("chat1");
    expect(turns.length).toBe(1);
    await history.append("chat1", [{ content: "hello", role: "assistant" }]);
  });

  it("defines DedupeStore interface", async () => {
    const dedupe: DedupeStore = {
      has: (key: string) => Promise.resolve(key === "seen"),
      set: (_key: string, _ttlMs: number) => {
        /* intentionally empty */
        return Promise.resolve();
      },
    };
    expect(await dedupe.has("seen")).toBe(true);
    expect(await dedupe.has("new")).toBe(false);
    await dedupe.set("new", 1000);
  });

  it("defines RateLimiter interface", async () => {
    const limiter: RateLimiter = {
      allow: (key: string) => Promise.resolve(key !== "blocked"),
      reset: (_key: string) => {
        /* intentionally empty */
      },
    };
    expect(await limiter.allow("ok")).toBe(true);
    expect(await limiter.allow("blocked")).toBe(false);
    limiter.reset?.("blocked");
  });

  it("defines BotState interface", () => {
    let paused = false;
    const state: BotState = {
      paused: false,
      setPaused: (v: boolean) => {
        paused = v;
      },
    };
    state.setPaused(true);
    expect(paused).toBe(true);
  });

  it("defines ReplyGenerator interface", async () => {
    const generator: ReplyGenerator = {
      generate: (_system: string, _messages: Turn[]) =>
        Promise.resolve("response"),
    };
    const result = await generator.generate("", [
      { content: "hi", role: "user" },
    ]);
    expect(result).toBe("response");
  });

  it("defines ImageDescriber interface", async () => {
    const describer: ImageDescriber = {
      describe: (_data: Uint8Array, _mime: string) =>
        Promise.resolve("a photo"),
    };
    const desc = await describer.describe(new Uint8Array([1]), "image/png");
    expect(desc).toBe("a photo");
  });

  it("defines Logger interface", () => {
    const logs: string[] = [];
    const logger: Logger = {
      error: (..._a: unknown[]) => logs.push("error"),
      info: (..._a: unknown[]) => logs.push("info"),
      warn: (..._a: unknown[]) => logs.push("warn"),
    };
    logger.info("test");
    logger.warn("test");
    logger.error("test");
    expect(logs.length).toBe(3);
  });

  it("defines HandleResult variants", () => {
    const r1: HandleResult = { kind: "replied" };
    const r2: HandleResult = { kind: "command" };
    const r3: HandleResult = { kind: "skipped", reason: "duplicate" };
    const r4: HandleResult = {
      detail: "info",
      kind: "skipped",
      reason: "paused",
    };
    const r5: HandleResult = { error: new Error("fail"), kind: "failed" };
    expect(r1.kind).toBe("replied");
    expect(r2.kind).toBe("command");
    expect(r3.kind).toBe("skipped");
    expect(r4.detail).toBe("info");
    expect(r5.kind).toBe("failed");
  });
});
