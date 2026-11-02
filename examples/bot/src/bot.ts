import type {
  Channel,
  LearningObserver,
  Logger,
  PersonaPatch,
  PromptWeights,
  ReplyGenerator,
} from "@persona/core";
import type { LearningStore } from "@persona/learning";
import { createMemory, type MemoryStores } from "@persona/memory";
import { type ConfiguredPersona, createPersona } from "@persona/persona";
import type { Persona } from "@persona/schemas";
import { type BotConfig, csv } from "./config";
import {
  createLearningWiring,
  type DatasetSink,
  memoryLearningStore,
} from "./learning";
import { personalAnswer } from "./personal";
import { noBrazilian, noExplicit, noRunaway } from "./safety";

export interface BuildBotOptions {
  channel: Channel;
  config: BotConfig;
  /** Where !dataset writes its entries. Without it, !dataset says no location is set. */
  datasetSink?: DatasetSink | undefined;
  /** The model that writes replies. */
  generator: ReplyGenerator;
  /** Records outcomes for continuous learning, alongside the built-in learning. */
  learning?: LearningObserver | undefined;
  /** Where learning state is saved. Without it, learning state lives in memory only. */
  learningStore?: LearningStore | undefined;
  logger?: Logger | undefined;
  /** Override the default in-memory store, e.g. with KV or files. */
  memory?: MemoryStores | undefined;
  /** Called with a persona patch after distillation. */
  onPatch?: ((patch: PersonaPatch) => void | Promise<void>) | undefined;
  persona: Persona;
  /** Update the prompt weights at runtime. */
  setPromptWeights?: ((w: PromptWeights) => void) | undefined;
  /** Update the recall weights at runtime. */
  setRecallWeights?:
    | ((w: {
        keywordWeight: number;
        semanticWeight: number;
        rrfK: number;
      }) => undefined)
    | undefined;
}

/**
 * The only place this app decides how the bot behaves: which model, who
 * may run admin commands, when it answers without being asked, and whether
 * it learns. Async because learning loads its saved state first.
 */
export async function buildBot(
  opts: BuildBotOptions
): Promise<ConfiguredPersona> {
  const { config } = opts;

  const learningOn = config.LEARNING_ENABLED === "true";
  if (learningOn && !opts.learningStore) {
    opts.logger?.warn(
      "LEARNING_ENABLED is set but no learning store is configured; learning state is in memory only."
    );
  }
  const wiring = learningOn
    ? await createLearningWiring({
        config,
        dataset: opts.datasetSink,
        logger: opts.logger,
        store: opts.learningStore ?? memoryLearningStore(),
      })
    : undefined;

  const bot = createPersona({
    admins: csv(config.ADMIN_NUMBERS),
    channel: opts.channel,
    commands: wiring?.commands,
    contextWeights: wiring?.contextWeights,
    generator: opts.generator,
    guards: [noExplicit, noRunaway, noBrazilian],
    learning: wiring ? fanOut(wiring.observer, opts.learning) : opts.learning,
    logger: opts.logger,
    memory:
      opts.memory ??
      createMemory({
        maxPerWindow: config.MAX_PER_10MIN,
        rateWindowMs: 600_000,
      }),
    onPatch: opts.onPatch,
    persona: opts.persona,
    policy: {
      // A linked device answers every direct chat; the Cloud API only when addressed.
      // The linked device answers every direct chat.
      direct: "always",
      group: "addressed",
    },
    prompt: {
      extraRules: [
        "Answer what was actually asked, with real words. Do not reply with laughter alone.",
        "Write in European Portuguese: tu and estás, never você, vc, pra, tmb or bora.",
        "Never invent personal details: age, city, job, school, family, pets, partner or possessions. If the persona does not state it, say you don't know or change the subject.",
      ],
      maxExchangeChars: 90,
      maxExchanges: config.PROMPT_EXCHANGES,
    },
    recallLimit: config.RECALL_LIMIT,
    setPromptWeights: opts.setPromptWeights,
    setRecallWeights: opts.setRecallWeights,
    topicPhrases: wiring?.topicPhrases,
  });

  wiring?.attach(bot);

  // Personal questions are answered from confirmed facts, not generated (see personal.ts).
  // The override mutates the bot instead of copying it, so live getters such as the prompt stay current.
  const generated = bot.handle;
  bot.handle = async (msg) => {
    const answer =
      msg.isGroup && !msg.mentionsBot ? undefined : personalAnswer(msg.text);
    if (answer === undefined) {
      return generated(msg);
    }
    await opts.channel.send(msg.chatId, answer, msg.id);
    return { kind: "replied" };
  };
  return bot;
}

/** Sends each outcome to every observer. Missing observers are skipped. */
function fanOut(
  ...observers: (LearningObserver | undefined)[]
): LearningObserver {
  const active = observers.filter(
    (o): o is LearningObserver => o !== undefined
  );
  return {
    recordOutcome(input) {
      for (const observer of active) {
        observer.recordOutcome(input);
      }
    },
  };
}
