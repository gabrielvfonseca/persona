import type {
  Channel,
  ContextLookup,
  ContextWeights,
  ImageDescriber,
  LearningObserver,
  Logger,
  OutcomeInput,
  PersonaPatch,
  PromptWeights,
  RecallWeights,
  ReplyGenerator,
} from "@persona/core";
import { contextLookup, uniqueStrings } from "@persona/core";
import { createMemory, type MemoryStores } from "@persona/memory";
import {
  type CommandHooks,
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

/** Returns the learned weights for a message's topic or context, or `undefined` to use the global weights. */
export type ContextWeightsLookup = (
  lookup: ContextLookup
) => ContextWeights | undefined;

export interface PersonaOptions {
  /** Phone numbers or ids allowed to run admin commands. */
  admins?: string[] | undefined;
  channel: Channel;
  /** Hooks for admin commands: ratings, weights, dataset, distillation and !learn. */
  commands?: CommandHooks | undefined;
  /**
   * Per-context weights from the learning state. Each message uses the weights
   * for its context (`dm`, `group:4`, …) for both prompt and recall, and falls
   * back to the global weights when the context has none.
   */
  contextWeights?: ContextWeightsLookup | undefined;
  describer?: ImageDescriber | undefined;
  generator: ReplyGenerator;
  /** Adds to the default guards (no echo of persona quotes). */
  guards?: ReplyGuard[] | undefined;
  /** Records outcomes for continuous learning. Fire-and-forget. */
  learning?: LearningObserver | undefined;
  logger?: Logger | undefined;
  /** Defaults to an in-memory store. Pass your own to persist state. */
  memory?: MemoryStores | undefined;
  /** Called with a persona patch after distillation. */
  onPatch?: ((patch: PersonaPatch) => void | Promise<void>) | undefined;
  persona: Persona;
  policy?: ReplyPolicyOptions | undefined;
  prompt?: PromptOptions | undefined;
  /** Past messages added to each prompt. 0 turns recall off. */
  recallLimit?: number | undefined;
  /** Update the prompt weights at runtime. */
  setPromptWeights?: ((w: PromptWeights) => void) | undefined;
  /** Update the recall weights at runtime. */
  setRecallWeights?: ((w: RecallWeights) => undefined) | undefined;
  /** Phrases the persona has used for a topic, shown to the model for messages on that topic. */
  topicPhrases?: ((topic: string) => string[] | undefined) | undefined;
  /** Overrides the default transforms (speaker prefix, first sentence). */
  transforms?: ReplyTransform[] | undefined;
  /**
   * Tunable prompt weights, adjusted by the learning engine. When set, these
   * win over `prompt.maxWords`. When unset, `prompt.maxWords` (default 15) is used.
   */
  weights?: PromptWeights | undefined;
}

export interface ConfiguredPersona extends PersonaBot {
  /** Apply a persona patch and rebuild the system prompt. */
  applyPatch: (patch: PersonaPatch) => void;
  memory: MemoryStores;
  /** Update the prompt weights at runtime. */
  setPromptWeights: (w: PromptWeights) => void;
  /** Update the recall weights at runtime. */
  setRecallWeights: (w: RecallWeights) => void;
  get systemPrompt(): string;
}

const consoleLogger: Logger = {
  error: (...a) => console.error(...a),
  info: () => undefined,
  warn: (...a) => console.warn(...a),
};

/** Distinct prompt texts kept at once. Weights move on every outcome, so this must stay small. */
const PROMPT_CACHE_LIMIT = 32;

/**
 * Renders the system prompt for a set of weights. Renders are cached by the
 * weights themselves, so a weight change always produces a fresh prompt.
 * `clear` drops the cache when the persona changes.
 */
function createPromptRenderer(
  persona: Persona,
  prompt: PromptOptions | undefined
) {
  const cache = new Map<string, string>();
  return {
    clear(): void {
      cache.clear();
    },
    render(weights: PromptWeights, topicPhrases: string[] | undefined): string {
      const fingerprint = JSON.stringify([weights, topicPhrases ?? []]);
      const cached = cache.get(fingerprint);
      if (cached !== undefined) {
        return cached;
      }
      if (cache.size >= PROMPT_CACHE_LIMIT) {
        cache.clear();
      }
      const text = buildSystemPrompt(persona, {
        ...prompt,
        topicPhrases,
        weights,
      });
      cache.set(fingerprint, text);
      return text;
    },
  };
}

function wrapLearningObserver(
  learning: LearningObserver | undefined,
  personaStats: { medianLen: number }
): LearningObserver | undefined {
  if (!learning) {
    return undefined;
  }
  return {
    recordOutcome(input: OutcomeInput) {
      try {
        learning.recordOutcome(
          input.personaStats ? input : { ...input, personaStats }
        );
      } catch {
        // fire-and-forget: learning must never break a reply
      }
    },
  };
}

/**
 * The one-call way to build a persona bot. Wires memory, policy, commands,
 * the system prompt and default guards. Every part can be replaced.
 */
export function createPersona(opts: PersonaOptions): ConfiguredPersona {
  const { persona } = opts;
  const memory = opts.memory ?? createMemory();
  let weights: PromptWeights = opts.weights ?? {
    exampleBoost: 1,
    extraRules: [],
    maxWords: opts.prompt?.maxWords ?? 15,
    styleGuideStrength: 1,
  };
  const renderer = createPromptRenderer(persona, opts.prompt);
  const promptFor = (lookup: ContextLookup): string =>
    renderer.render(
      opts.contextWeights?.(lookup)?.prompt ?? weights,
      lookup.topic === undefined ? undefined : opts.topicPhrases?.(lookup.topic)
    );
  const recallLimit = opts.recallLimit ?? 0;

  const bot = createPersonaBot({
    channel: opts.channel,
    commands: createCommands({
      adminNumbers: opts.admins ?? [],
      botName: persona.name,
      state: memory.state,
      ...opts.commands,
      // By default !learn adds the fact to the persona. onPatch still fires, so the app can persist it.
      onLearn:
        opts.commands?.onLearn ??
        ((fact) => {
          applyPatch({ facts: [fact] });
        }),
    }),
    dedupe: memory.dedupe,
    describer: opts.describer,
    examples: persona.quotes,
    generator: opts.generator,
    guards: [noEcho, ...(opts.guards ?? [])],
    history: memory.history,
    learning: wrapLearningObserver(opts.learning, persona.stats),
    logger: opts.logger ?? consoleLogger,
    policy: createReplyPolicy({
      direct: "addressed",
      group: "addressed",
      names: [persona.name],
      ...opts.policy,
    }),
    rateLimiter: memory.rateLimiter,
    recall:
      recallLimit > 0
        ? async (chatId, query, lookup) =>
            (
              await memory.recall(
                chatId,
                query,
                recallLimit,
                opts.contextWeights?.(lookup)?.recall
              )
            ).map((n) => n.text)
        : undefined,
    state: memory.state,
    systemPrompt: (msg) => promptFor(contextLookup(msg)),
    transforms: opts.transforms ?? [stripSpeakerPrefix, firstSentence],
  });

  const applyPatch = (patch: PersonaPatch) => {
    if (patch.facts) {
      persona.facts = uniqueStrings([...(persona.facts ?? []), ...patch.facts]);
    }
    if (patch.phrases) {
      persona.phrases = uniqueStrings([
        ...(persona.phrases ?? []),
        ...patch.phrases,
      ]);
    }
    if (patch.styleGuide) {
      persona.styleGuide = [persona.styleGuide ?? "", patch.styleGuide]
        .filter(Boolean)
        .join("\n\n");
    }
    renderer.clear();
    opts.onPatch?.(patch);
  };

  const setPromptWeights = (w: PromptWeights) => {
    weights = w;
    opts.setPromptWeights?.(w);
  };

  const setRecallWeights = (w: RecallWeights) => {
    memory.setRecallWeights(w);
    opts.setRecallWeights?.(w);
  };

  return {
    ...bot,
    applyPatch,
    memory,
    setPromptWeights,
    setRecallWeights,
    get systemPrompt() {
      return renderer.render(weights, undefined);
    },
  };
}
