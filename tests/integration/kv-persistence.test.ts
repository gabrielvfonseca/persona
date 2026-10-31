import {
  kvDedupeStore,
  kvHistoryStore,
  kvRateLimiter,
  loadKvBotState,
  type PersistentBotState,
} from "@persona/kv";
import { createMemory } from "@persona/memory";
import { createPersona } from "@persona/persona";
import { describe, expect, it } from "vitest";
import {
  fakeChannel,
  fakeGenerator,
  memoryKv,
  persona,
  silentLogger,
} from "../helpers/fakes";

/** Builds a bot whose history, dedupe, rate limit and pause state all live in `kv`. */
async function kvBot(kv: ReturnType<typeof memoryKv>, reply = "ok") {
  const generator = fakeGenerator(reply);
  const channel = fakeChannel();
  const memory = {
    ...createMemory(),
    history: kvHistoryStore(kv),
    dedupe: kvDedupeStore(kv),
    rateLimiter: kvRateLimiter(kv, { maxPerWindow: 3 }),
    state: await loadKvBotState(kv),
  };
  const bot = createPersona({
    persona: persona(),
    channel,
    generator,
    memory,
    logger: silentLogger,
    policy: { direct: "always" },
    admins: ["5511999999999"],
  });
  return {
    bot,
    generator,
    channel,
    memory,
    state: memory.state as PersistentBotState,
  };
}

const msg = (id: string, text = "hello", senderId?: string) => ({
  id,
  chatId: "chat-1",
  text,
  senderId,
});

describe("KV-backed history", () => {
  it("keeps the conversation across bot instances that share a KV", async () => {
    const kv = memoryKv();
    const first = await kvBot(kv);
    await first.bot.handle(msg("1", "remember the color blue"));

    const second = await kvBot(kv);
    await second.bot.handle(msg("2", "what color did I say?"));

    const turns = second.generator.calls[0]?.messages ?? [];
    expect(turns[0]).toEqual({
      role: "user",
      content: "remember the color blue",
    });
    expect(turns[1]).toEqual({ role: "assistant", content: "ok" });
  });

  it("keeps only the last 20 turns per chat", async () => {
    const kv = memoryKv();
    const store = kvHistoryStore(kv);
    const turns = Array.from({ length: 25 }, (_, i) => ({
      role: "user" as const,
      content: `turn ${i}`,
    }));

    await store.append("chat-1", turns);

    const loaded = await store.load("chat-1");
    expect(loaded).toHaveLength(20);
    expect(loaded[0]?.content).toBe("turn 5");
    expect(loaded.at(-1)?.content).toBe("turn 24");
  });

  it("returns an empty history for a corrupt entry", async () => {
    const kv = memoryKv();
    kv.data.set("chat:chat-1", "{not json");

    expect(await kvHistoryStore(kv).load("chat-1")).toEqual([]);
  });

  it("does not store history when generation fails", async () => {
    const kv = memoryKv();
    const generator = {
      async generate(): Promise<string> {
        throw new Error("model down");
      },
    };
    const bot = createPersona({
      persona: persona(),
      channel: fakeChannel(),
      generator,
      logger: silentLogger,
      policy: { direct: "always" },
      memory: { ...createMemory(), history: kvHistoryStore(kv) },
    });

    const result = await bot.handle(msg("1"));

    expect(result.kind).toBe("failed");
    expect(kv.data.has("chat:chat-1")).toBe(false);
  });
});

describe("KV-backed dedupe", () => {
  it("drops a message id seen by an earlier instance", async () => {
    const kv = memoryKv();
    const first = await kvBot(kv);
    await first.bot.handle(msg("same-id"));

    const second = await kvBot(kv);
    const result = await second.bot.handle(msg("same-id"));

    expect(result).toEqual({ kind: "skipped", reason: "duplicate" });
    expect(second.generator.calls).toHaveLength(0);
  });

  it("writes dedupe keys with a TTL of at least 60 seconds", async () => {
    const kv = memoryKv();
    await kvDedupeStore(kv).set("whatsapp:1", 1_000);

    const put = kv.puts.find((p) => p.key === "dedupe:whatsapp:1");
    expect(put?.ttl).toBe(60);
  });
});

describe("KV-backed pause state", () => {
  it("keeps a pause across instances once flushed", async () => {
    const kv = memoryKv();
    const first = await kvBot(kv);

    await first.bot.handle(msg("1", "!pause", "5511999999999"));
    await first.state.flush();

    const second = await kvBot(kv);
    const result = await second.bot.handle(msg("2", "are you there?"));

    expect(result).toEqual({ kind: "skipped", reason: "paused" });
  });

  it("writes '1' for paused and '0' for resumed", async () => {
    const kv = memoryKv();
    const state = await loadKvBotState(kv);

    state.setPaused(true);
    await state.flush();
    expect(kv.data.get("bot:paused")).toBe("1");

    state.setPaused(false);
    await state.flush();
    expect(kv.data.get("bot:paused")).toBe("0");
  });
});

describe("KV-backed rate limit", () => {
  it("blocks after the limit within one window and reopens after it", async () => {
    const kv = memoryKv();
    let now = 0;
    const limiter = kvRateLimiter(kv, {
      maxPerWindow: 2,
      windowMs: 60_000,
      now: () => now,
    });

    expect(await limiter.allow("chat")).toBe(true);
    expect(await limiter.allow("chat")).toBe(true);
    expect(await limiter.allow("chat")).toBe(false);

    now = 60_000;
    expect(await limiter.allow("chat")).toBe(true);
  });

  it("starts a fresh window when the stored entry is corrupt", async () => {
    const kv = memoryKv();
    kv.data.set("rl:chat", "garbage");
    const limiter = kvRateLimiter(kv, { maxPerWindow: 1 });

    expect(await limiter.allow("chat")).toBe(true);
  });
});
