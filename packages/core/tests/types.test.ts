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
    const turn: Turn = { role: "user", content: "hello" };
    expect(turn.role).toBe("user");
    expect(turn.content).toBe("hello");
  });

  it("defines assistant turn", () => {
    const turn: Turn = { role: "assistant", content: "hi" };
    expect(turn.role).toBe("assistant");
  });

  it("defines IncomingMessage with required fields", () => {
    const msg: IncomingMessage = {
      id: "123",
      chatId: "chat1",
      text: "hello",
    };
    expect(msg.id).toBe("123");
    expect(msg.chatId).toBe("chat1");
    expect(msg.text).toBe("hello");
  });

  it("defines IncomingMessage with optional fields", () => {
    const msg: IncomingMessage = {
      id: "123",
      chatId: "chat1",
      text: "hello",
      senderName: "Alice",
      isGroup: true,
      mentionsBot: true,
      repliesToBot: false,
    };
    expect(msg.senderName).toBe("Alice");
    expect(msg.isGroup).toBe(true);
    expect(msg.mentionsBot).toBe(true);
  });

  it("defines IncomingMessage with media", () => {
    const msg: IncomingMessage = {
      id: "123",
      chatId: "chat1",
      text: "photo",
      media: [
        { kind: "image", data: new Uint8Array([1, 2, 3]), mime: "image/png" },
      ],
    };
    expect(msg.media?.[0]?.kind).toBe("image");
    expect(msg.media?.[0]?.mime).toBe("image/png");
  });

  it("defines sticker media", () => {
    const msg: IncomingMessage = {
      id: "123",
      chatId: "chat1",
      text: "",
      media: [
        { kind: "sticker", data: new Uint8Array([]), mime: "image/webp" },
      ],
    };
    expect(msg.media?.[0]?.kind).toBe("sticker");
  });

  it("defines Channel interface", async () => {
    const channel: Channel = {
      name: "test",
      send: async (chatId: string, text: string, replyTo?: string) => {
        expect(chatId).toBe("chat1");
        expect(text).toBe("hi");
      },
    };
    await channel.send("chat1", "hi");
  });

  it("defines HistoryStore interface", async () => {
    const history: HistoryStore = {
      load: async (chatId: string) => [{ role: "user", content: "hi" }],
      append: async (chatId: string, turns: Turn[]) => {},
    };
    const turns = await history.load("chat1");
    expect(turns.length).toBe(1);
    await history.append("chat1", [{ role: "assistant", content: "hello" }]);
  });

  it("defines DedupeStore interface", async () => {
    const dedupe: DedupeStore = {
      has: async (key: string) => key === "seen",
      set: async (key: string, ttlMs: number) => {},
    };
    expect(await dedupe.has("seen")).toBe(true);
    expect(await dedupe.has("new")).toBe(false);
    await dedupe.set("new", 1000);
  });

  it("defines RateLimiter interface", async () => {
    const limiter: RateLimiter = {
      allow: async (key: string) => key !== "blocked",
      reset: (key: string) => {},
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
      generate: async (system: string, messages: Turn[]) => "response",
    };
    const result = await generator.generate("", [
      { role: "user", content: "hi" },
    ]);
    expect(result).toBe("response");
  });

  it("defines ImageDescriber interface", async () => {
    const describer: ImageDescriber = {
      describe: async (data: Uint8Array, mime: string) => "a photo",
    };
    const desc = await describer.describe(new Uint8Array([1]), "image/png");
    expect(desc).toBe("a photo");
  });

  it("defines Logger interface", () => {
    const logs: string[] = [];
    const logger: Logger = {
      info: (...a: unknown[]) => logs.push("info"),
      warn: (...a: unknown[]) => logs.push("warn"),
      error: (...a: unknown[]) => logs.push("error"),
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
      kind: "skipped",
      reason: "paused",
      detail: "info",
    };
    const r5: HandleResult = { kind: "failed", error: new Error("fail") };
    expect(r1.kind).toBe("replied");
    expect(r2.kind).toBe("command");
    expect(r3.kind).toBe("skipped");
    expect(r4.detail).toBe("info");
    expect(r5.kind).toBe("failed");
  });
});
