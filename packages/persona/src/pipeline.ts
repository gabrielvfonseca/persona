import type {
  BotState,
  Channel,
  DedupeStore,
  HandleResult,
  HistoryStore,
  ImageDescriber,
  IncomingMessage,
  Logger,
  MessageHandler,
  RateLimiter,
  ReplyGenerator,
  Turn,
} from "@persona/core";
import type { createCommands, ReplyPolicy } from "@persona/policy";
import type { ReplyGuard, ReplyTransform } from "./guards";

const DEDUPE_TTL_MS = 300_000;

export interface PersonaBotOptions {
  channel: Channel;
  history: HistoryStore;
  generator: ReplyGenerator;
  policy: ReplyPolicy;
  logger: Logger;
  dedupe?: DedupeStore | undefined;
  rateLimiter?: RateLimiter | undefined;
  state?: BotState | undefined;
  describer?: ImageDescriber | undefined;
  commands?: ReturnType<typeof createCommands> | undefined;
  /** System prompt sent with every model call. */
  systemPrompt?: string | undefined;
  /** Applied to the model reply in order, before guards. */
  transforms?: ReplyTransform[] | undefined;
  /** Run after transforms and the empty check. */
  guards?: ReplyGuard[] | undefined;
  /** Strings the guards compare against, such as persona quotes. */
  examples?: string[] | undefined;
  /** Extra context lines for the system prompt, from past messages. */
  recall?:
    | ((chatId: string, query: string) => string[] | Promise<string[]>)
    | undefined;
}

export interface PersonaBot extends MessageHandler {
  state: BotState;
}

/**
 * Runs one message through the reply pipeline. `handle` never throws.
 *
 * dedupe → command → paused → policy → rate limit → describe media →
 * generate → transforms → empty check → guards → send → history
 */
export function createPersonaBot(opts: PersonaBotOptions): PersonaBot {
  const botState = opts.state ?? { paused: false, setPaused: () => {} };

  async function handle(msg: IncomingMessage): Promise<HandleResult> {
    try {
      return await run(msg);
    } catch (error) {
      opts.logger.error("pipeline error", { id: msg.id, chatId: msg.chatId });
      return { kind: "failed", error };
    }
  }

  async function run(msg: IncomingMessage): Promise<HandleResult> {
    const { channel, history, logger } = opts;
    const dedupeKey = `${channel.name}:${msg.id}`;

    if (opts.dedupe && (await opts.dedupe.has(dedupeKey))) {
      return { kind: "skipped", reason: "duplicate" };
    }

    const command = await runCommand(msg);
    if (command) return command;

    if (botState.paused) {
      return { kind: "skipped", reason: "paused" };
    }

    const trigger = opts.policy.shouldReply({
      isGroup: Boolean(msg.isGroup),
      chatId: msg.chatId,
      text: msg.text,
      mentioned: Boolean(msg.mentionsBot),
    });
    if (trigger === "never") {
      return { kind: "skipped", reason: "not-addressed" };
    }

    if (
      opts.rateLimiter &&
      !(await opts.rateLimiter.allow(`${channel.name}:${msg.chatId}`))
    ) {
      return { kind: "skipped", reason: "rate-limited" };
    }

    const userContent = await buildUserContent(msg);
    const system = await withRecall(msg, opts.systemPrompt ?? "");
    const historyTurns = await history.load(msg.chatId);

    let reply: string;
    try {
      reply = await opts.generator.generate(system, [
        ...historyTurns,
        { content: userContent, role: "user" },
      ]);
    } catch (error) {
      logger.warn("generation failed", { id: msg.id, chatId: msg.chatId });
      return { kind: "failed", error };
    }

    for (const transform of opts.transforms ?? []) {
      reply = transform(reply);
    }
    if (!reply.trim()) {
      return { kind: "skipped", reason: "empty" };
    }
    const ctx = { examples: opts.examples ?? [] };
    if (!(opts.guards ?? []).every((g) => g(reply, ctx))) {
      return { kind: "skipped", reason: "guard" };
    }

    try {
      await channel.send(msg.chatId, reply, msg.id);
    } catch (error) {
      return { kind: "failed", error };
    }

    const turns: Turn[] = [
      { content: userContent, role: "user" },
      { content: reply, role: "assistant" },
    ];
    await recordTurns(msg, turns);
    if (opts.dedupe) {
      await opts.dedupe.set(dedupeKey, DEDUPE_TTL_MS).catch(() => {});
    }
    return { kind: "replied" };
  }

  async function runCommand(
    msg: IncomingMessage,
  ): Promise<HandleResult | null> {
    if (!opts.commands) return null;
    const participant = msg.senderId ?? msg.chatId;
    const result = await opts.commands.handle(msg.text, participant);
    if (!result.handled) return null;
    if (result.reply) {
      try {
        await opts.channel.send(msg.chatId, result.reply, msg.id);
      } catch (error) {
        return { kind: "failed", error };
      }
    }
    return { kind: "command" };
  }

  async function buildUserContent(msg: IncomingMessage): Promise<string> {
    let text =
      msg.isGroup && msg.senderName
        ? `${msg.senderName}: ${msg.text}`
        : msg.text;
    if (!opts.describer || !msg.media) return text;
    for (const m of msg.media) {
      try {
        const desc = await opts.describer.describe(m.data, m.mime);
        text += ` [${m.kind}: ${desc}]`;
      } catch {
        text += ` [${m.kind}: unavailable]`;
      }
    }
    return text;
  }

  async function withRecall(
    msg: IncomingMessage,
    system: string,
  ): Promise<string> {
    if (!opts.recall) return system;
    const lines = await opts.recall(msg.chatId, msg.text);
    if (lines.length === 0) return system;
    return [system, "Earlier in this chat:", ...lines.map((l) => `- ${l}`)]
      .filter(Boolean)
      .join("\n");
  }

  async function recordTurns(
    msg: IncomingMessage,
    turns: Turn[],
  ): Promise<void> {
    try {
      await opts.history.append(msg.chatId, turns);
    } catch {
      opts.logger.error("history append failed", {
        id: msg.id,
        chatId: msg.chatId,
      });
    }
  }

  return { handle, state: botState };
}
