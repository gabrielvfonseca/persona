import type {
  Channel,
  LearningObserver,
  Logger,
  Memory,
  PersonaPatch,
  PromptWeights,
  ReplyGenerator,
} from "@persona/core";
import { createMemory } from "@persona/memory";
import { type ConfiguredPersona, createPersona } from "@persona/persona";
import type { Persona } from "@persona/schemas";
import { type CloudApiConfig, csv, type LinkedDeviceConfig } from "./config";
import {
  openRouterDescriber,
  openRouterEmbedder,
  openRouterGenerator,
} from "./model";

export type Transport = "linked-device" | "cloud-api";

export interface BuildBotOptions {
  config: LinkedDeviceConfig | CloudApiConfig;
  persona: Persona;
  channel: Channel;
  transport: Transport;
  logger?: Logger | undefined;
  /** Override the default in-memory store, e.g. with KV or files. */
  memory?: Memory | undefined;
  /** Records outcomes for continuous learning. */
  learning?: LearningObserver | undefined;
  /** Called with a persona patch after distillation. */
  onPatch?: ((patch: PersonaPatch) => void | Promise<void>) | undefined;
  /** Update the prompt weights at runtime. */
  setPromptWeights?: ((w: PromptWeights) => void) | undefined;
  /** Update the recall weights at runtime. */
  setRecallWeights?: (
    w: { keywordWeight: number; semanticWeight: number; rrfK: number },
  ) => void | undefined;
}

/**
 * The only place this app decides how the bot behaves: which model, who
 * may run admin commands, and when it answers without being asked.
 */
export function buildBot(opts: BuildBotOptions): ConfiguredPersona {
  const { config, transport } = opts;
  const model = {
    apiKey: config.OPENROUTER_API_KEY,
    model: config.PERSONA_MODEL,
  };

  return createPersona({
    persona: opts.persona,
    channel: opts.channel,
    generator: openRouterGenerator(model) as ReplyGenerator,
    describer: config.STICKER_MODEL
      ? openRouterDescriber({ ...model, model: config.STICKER_MODEL })
      : undefined,
    logger: opts.logger,
    admins: csv(config.ADMIN_NUMBERS),
    policy: {
      // A linked device answers every direct chat; the Cloud API only when addressed.
      direct: transport === "linked-device" ? "always" : "addressed",
      group: "addressed",
    },
    recallLimit: config.RECALL_LIMIT,
    memory:
      opts.memory ??
      createMemory({
        maxPerWindow: config.MAX_PER_10MIN,
        rateWindowMs: 600_000,
        embedder: config.EMBEDDING_MODEL
          ? openRouterEmbedder({ ...model, model: config.EMBEDDING_MODEL })
          : undefined,
      }),
    learning: opts.learning,
    onPatch: opts.onPatch,
    setPromptWeights: opts.setPromptWeights,
    setRecallWeights: opts.setRecallWeights,
  });
}