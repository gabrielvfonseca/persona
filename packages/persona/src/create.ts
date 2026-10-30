import type {
  Channel,
  ImageDescriber,
  Logger,
  ReplyGenerator,
} from "@persona/core";
import { createMemory, type Memory } from "@persona/memory";
import {
  createCommands,
  createReplyPolicy,
  type ReplyPolicyOptions,
} from "@persona/policy";
import type { Persona } from "@persona/schemas";
import {
  firstSentence,
  noEcho,
  type ReplyGuard,
  type ReplyTransform,
  stripSpeakerPrefix,
} from "./guards";
import { createPersonaBot, type PersonaBot } from "./pipeline";
import { buildSystemPrompt, type PromptOptions } from "./prompt";

export interface PersonaOptions {
  persona: Persona;
  channel: Channel;
  generator: ReplyGenerator;
  describer?: ImageDescriber | undefined;
  logger?: Logger | undefined;
  /** Phone numbers or ids allowed to run admin commands. */
  admins?: string[] | undefined;
  policy?: ReplyPolicyOptions | undefined;
  prompt?: PromptOptions | undefined;
  /** Defaults to an in-memory store. Pass your own to persist state. */
  memory?: Memory | undefined;
  /** Past messages added to each prompt. 0 turns recall off. */
  recallLimit?: number | undefined;
  /** Overrides the default transforms (speaker prefix, first sentence). */
  transforms?: ReplyTransform[] | undefined;
  /** Adds to the default guards (no echo of persona quotes). */
  guards?: ReplyGuard[] | undefined;
}

export type ConfiguredPersona = PersonaBot & {
  systemPrompt: string;
  memory: Memory;
};

const consoleLogger: Logger = {
  info: () => {},
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
};

/**
 * The one-call way to build a persona bot. Wires memory, policy, commands,
 * the system prompt and default guards. Every part can be replaced.
 */
export function createPersona(opts: PersonaOptions): ConfiguredPersona {
  const { persona } = opts;
  const memory = opts.memory ?? createMemory();
  const systemPrompt = buildSystemPrompt(persona, opts.prompt);
  const recallLimit = opts.recallLimit ?? 0;

  const bot = createPersonaBot({
    channel: opts.channel,
    history: memory.history,
    dedupe: memory.dedupe,
    rateLimiter: memory.rateLimiter,
    state: memory.state,
    generator: opts.generator,
    describer: opts.describer,
    logger: opts.logger ?? consoleLogger,
    policy: createReplyPolicy({
      names: [persona.name],
      direct: "addressed",
      group: "addressed",
      ...opts.policy,
    }),
    commands: createCommands({
      adminNumbers: opts.admins ?? [],
      botName: persona.name,
      state: memory.state,
    }),
    systemPrompt,
    transforms: opts.transforms ?? [stripSpeakerPrefix, firstSentence],
    guards: [noEcho, ...(opts.guards ?? [])],
    examples: persona.quotes,
    recall:
      recallLimit > 0
        ? async (chatId, query) =>
            (await memory.recall(chatId, query, recallLimit)).map((n) => n.text)
        : undefined,
  });

  return { ...bot, systemPrompt, memory };
}
