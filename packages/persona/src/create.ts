import type {
  Channel,
  ImageDescriber,
  LearningObserver,
  Logger,
  PersonaPatch,
  PromptWeights,
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
  /** Records outcomes for continuous learning. Fire-and-forget. */
  learning?: LearningObserver | undefined;
  /** Tunable prompt weights, adjusted by the learning engine. */
  weights?: PromptWeights | undefined;
  /** Called with a persona patch after distillation. */
  onPatch?: ((patch: PersonaPatch) => void | Promise<void>) | undefined;
  /** Update the prompt weights at runtime. */
  setPromptWeights?: ((w: PromptWeights) => void) | undefined;
  /** Update the recall weights at runtime. */
  setRecallWeights?: (
    w: { keywordWeight: number; semanticWeight: number; rrfK: number },
  ) => void | undefined;
}

export interface ConfiguredPersona extends PersonaBot {
  systemPrompt: string;
  memory: Memory;
  /** Apply a persona patch and rebuild the system prompt. */
  applyPatch(patch: PersonaPatch): void;
  /** Update the prompt weights at runtime. */
  setPromptWeights(w: PromptWeights): void;
  /** Update the recall weights at runtime. */
  setRecallWeights(w: {
    keywordWeight: number;
    semanticWeight: number;
    rrfK: number;
  }): void;
}

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
  const persona = opts.persona;
  const memory = opts.memory ?? createMemory();
  let weights = opts.weights ?? {
    maxWords: 15,
    exampleBoost: 1,
    styleGuideStrength: 1,
    extraRules: [],
  };
  let systemPrompt = buildSystemPrompt(persona, { ...opts.prompt, weights });
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
    learning: opts.learning,
  });

  const applyPatch = (patch: PersonaPatch) => {
    if (patch.facts) persona.facts = unique([...persona.facts, ...patch.facts]);
    if (patch.phrases) persona.phrases = unique([...persona.phrases, ...patch.phrases]);
    if (patch.styleGuide) {
      persona.styleGuide = [persona.styleGuide, patch.styleGuide]
        .filter(Boolean)
        .join("\n\n");
    }
    systemPrompt = buildSystemPrompt(persona, { ...opts.prompt, weights });
    bot.systemPrompt = systemPrompt;
    opts.onPatch?.(patch);
  };

  const setPromptWeights = (w: PromptWeights) => {
    weights = w;
    opts.setPromptWeights?.(w);
    systemPrompt = buildSystemPrompt(persona, { ...opts.prompt, weights });
    bot.systemPrompt = systemPrompt;
  };

  const setRecallWeights = (w: {
    keywordWeight: number;
    semanticWeight: number;
    rrfK: number;
  }) => {
    memory.setRecallWeights(w);
    opts.setRecallWeights?.(w);
  };

  return {
    ...bot,
    systemPrompt,
    memory,
    applyPatch,
    setPromptWeights,
    setRecallWeights,
  };
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}