import type {
  BotState,
  Channel,
  ContextLookup,
  DedupeStore,
  HandleResult,
  HistoryStore,
  ImageDescriber,
  IncomingMessage,
  LearningObserver,
  Logger,
  MessageHandler,
  RateLimiter,
  ReplyGenerator,
  Turn,
} from "@persona/core";
import { contextLookup } from "@persona/core";
import type { createCommands, ReplyPolicy } from "@persona/policy";
import type { ReplyGuard, ReplyTransform } from "./guards";

const DEDUPE_TTL_MS = 300_000;

export interface PersonaBotOptions {
  channel: Channel;
  commands?: ReturnType<typeof createCommands> | undefined;
  dedupe?: DedupeStore | undefined;
  describer?: ImageDescriber | undefined;
  /** Strings the guards compare against, such as persona quotes. */
  examples?: string[] | undefined;
  generator: ReplyGenerator;
  /** Run after transforms and the empty check. */
  guards?: ReplyGuard[] | undefined;
  history: HistoryStore;
  /** Records outcomes for continuous learning. Fire-and-forget. */
  learning?: LearningObserver | undefined;
  logger: Logger;
  policy: ReplyPolicy;
  rateLimiter?: RateLimiter | undefined;
  /** Extra context lines for the system prompt, from past messages. */
  /** Looks up earlier lines for the reply, using the message's context and topic. */
  recall?:
    | ((
        chatId: string,
        query: string,
        lookup: ContextLookup
      ) => string[] | Promise<string[]>)
    | undefined;
  state?: BotState | undefined;
  /** System prompt sent with every model call. A getter receives the message, so the prompt can depend on its context. */
  systemPrompt?: string | ((msg: IncomingMessage) => string) | undefined;
  /** Applied to the model reply in order, before guards. */
  transforms?: ReplyTransform[] | undefined;
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
  const botState = opts.state ?? {
    paused: false,
    setPaused: () => {
      /* intentionally empty */
    },
  };
  const { learning } = opts;

  function resolveSystem(msg: IncomingMessage): string {
    const sp = opts.systemPrompt;
    return typeof sp === "function" ? sp(msg) : (sp ?? "");
  }

  async function handle(msg: IncomingMessage): Promise<HandleResult> {
    try {
      const result = await run(msg);
      // Guard skips are recorded inside run(), where the reply text is known.
      if (result.kind === "skipped" && result.reason !== "guard") {
        learning?.recordOutcome({
          examples: opts.examples ?? [],
          historyTurns: [],
          msg,
          recallLines: [],
          result,
          systemPrompt: resolveSystem(msg),
          transformed: false,
        });
      }
      return result;
    } catch (error) {
      opts.logger.error("pipeline error", { chatId: msg.chatId, id: msg.id });
      learning?.recordOutcome({
        examples: opts.examples ?? [],
        historyTurns: [],
        msg,
        recallLines: [],
        result: { error, kind: "failed" },
        systemPrompt: resolveSystem(msg),
        transformed: false,
      });
      return { error, kind: "failed" };
    }
  }

  /** The checks that decide whether a message is handled at all. Returns the outcome when it is not. */
  async function admit(
    msg: IncomingMessage
  ): Promise<HandleResult | undefined> {
    const { channel } = opts;
    const dedupeKey = `${channel.name}:${msg.id}`;

    if (opts.dedupe && (await opts.dedupe.has(dedupeKey))) {
      return { kind: "skipped", reason: "duplicate" };
    }

    const command = await runCommand(msg);
    if (command) {
      return command;
    }

    if (botState.paused) {
      return { kind: "skipped", reason: "paused" };
    }

    const trigger = opts.policy.shouldReply({
      chatId: msg.chatId,
      isGroup: Boolean(msg.isGroup),
      mentioned: Boolean(msg.mentionsBot),
      text: msg.text,
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
    return undefined;
  }

  async function run(msg: IncomingMessage): Promise<HandleResult> {
    const { channel, history, logger } = opts;
    const dedupeKey = `${channel.name}:${msg.id}`;

    const refused = await admit(msg);
    if (refused) {
      return refused;
    }

    const userContent = await buildUserContent(msg);
    const system = await withRecall(msg, resolveSystem(msg));
    const historyTurns = await history.load(msg.chatId);

    let reply: string;
    try {
      reply = await opts.generator.generate(system, [
        ...historyTurns,
        { content: userContent, role: "user" },
      ]);
    } catch (error) {
      logger.warn("generation failed", { chatId: msg.chatId, id: msg.id });
      observe(msg, system, historyTurns, {
        result: { error, kind: "failed" },
        transformed: false,
      });
      return { error, kind: "failed" };
    }

    const replyBefore = reply;
    reply = applyTransforms(reply);
    const transformed = reply !== replyBefore;
    if (!reply.trim()) {
      return { kind: "skipped", reason: "empty" };
    }
    if (!passesGuards(reply)) {
      observe(msg, system, historyTurns, {
        replyText: reply,
        result: { kind: "skipped", reason: "guard" },
        transformed,
      });
      return { kind: "skipped", reason: "guard" };
    }

    try {
      await channel.send(msg.chatId, reply, msg.id);
    } catch (error) {
      observe(msg, system, historyTurns, {
        result: { error, kind: "failed" },
        transformed,
      });
      return { error, kind: "failed" };
    }

    const turns: Turn[] = [
      { content: userContent, role: "user" },
      { content: reply, role: "assistant" },
    ];
    await recordTurns(msg, turns);
    if (opts.dedupe) {
      await opts.dedupe.set(dedupeKey, DEDUPE_TTL_MS).catch(() => {
        /* intentionally empty */
      });
    }
    observe(msg, system, historyTurns, {
      replyText: reply,
      result: { kind: "replied" },
      transformed,
    });
    return { kind: "replied" };
  }

  /** Reports one outcome to the learning observer, with the context the pipeline used. */
  function observe(
    msg: IncomingMessage,
    system: string,
    historyTurns: Turn[],
    fields: Pick<
      NonNullable<Parameters<LearningObserver["recordOutcome"]>[0]>,
      "result" | "replyText" | "transformed"
    >
  ): void {
    learning?.recordOutcome({
      examples: opts.examples ?? [],
      historyTurns,
      msg,
      recallLines: [],
      systemPrompt: system,
      ...fields,
    });
  }

  function applyTransforms(text: string): string {
    return (opts.transforms ?? []).reduce(
      (current, transform) => transform(current),
      text
    );
  }

  function passesGuards(text: string): boolean {
    const ctx = { examples: opts.examples ?? [] };
    return (opts.guards ?? []).every((guard) => guard(text, ctx));
  }

  async function runCommand(
    msg: IncomingMessage
  ): Promise<HandleResult | null> {
    if (!opts.commands) {
      return null;
    }
    const participant = msg.senderId ?? msg.chatId;
    const result = await opts.commands.handle(msg.text, participant, {
      chatId: msg.chatId,
    });
    if (!result.handled) {
      return null;
    }
    if (result.reply) {
      try {
        await opts.channel.send(msg.chatId, result.reply, msg.id);
      } catch (error) {
        return { error, kind: "failed" };
      }
    }
    return { kind: "command" };
  }

  async function buildUserContent(msg: IncomingMessage): Promise<string> {
    let text =
      msg.isGroup && msg.senderName
        ? `${msg.senderName}: ${msg.text}`
        : msg.text;
    if (!(opts.describer && msg.media)) {
      return text;
    }
    for (const m of msg.media) {
      try {
        // biome-ignore lint/performance/noAwaitInLoops: media is described one at a time to keep model load bounded
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
    system: string
  ): Promise<string> {
    if (!opts.recall) {
      return system;
    }
    const lines = await opts.recall(msg.chatId, msg.text, contextLookup(msg));
    if (lines.length === 0) {
      return system;
    }
    return [system, "Earlier in this chat:", ...lines.map((l) => `- ${l}`)]
      .filter(Boolean)
      .join("\n");
  }

  async function recordTurns(
    msg: IncomingMessage,
    turns: Turn[]
  ): Promise<void> {
    try {
      await opts.history.append(msg.chatId, turns);
    } catch {
      opts.logger.error("history append failed", {
        chatId: msg.chatId,
        id: msg.id,
      });
    }
  }

  return { handle, state: botState };
}
