import {
  type DatasetEntry,
  type LearningObserver,
  type PersonaPatch,
  resolveContextWeights,
} from "@persona/core";
import { type LearningStore, LearningSystem } from "@persona/learning";
import type { ConfiguredPersona, ContextWeightsLookup } from "@persona/persona";
import type { CommandHooks } from "@persona/policy";

/** Where the fine-tune dataset goes when `!dataset` runs. Returns a human-readable location. */
export interface DatasetSink {
  save: (entries: DatasetEntry[]) => Promise<string>;
}

/** A learning store and dataset sink backed by one key-value namespace (Postgres `kv` table). */
export interface KvLike {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string) => Promise<void>;
}

export function pgLearningStore(kv: KvLike): LearningStore {
  return {
    get: (key) => kv.get(key),
    set: (key, value) => kv.put(key, value),
  };
}

export function pgDatasetSink(kv: KvLike): DatasetSink {
  return {
    async save(entries) {
      const key = `dataset:${new Date().toISOString()}`;
      await kv.put(key, entries.map((e) => JSON.stringify(e)).join("\n"));
      return `kv key ${key}`;
    },
  };
}

/** Process-lifetime store for when no persistence is configured. Lost on restart. */
export function memoryLearningStore(): LearningStore & {
  data: Map<string, string>;
} {
  const data = new Map<string, string>();
  return {
    data,
    get: (key) => Promise.resolve(data.get(key) ?? null),
    set: (key, value) => {
      data.set(key, value);
    },
  };
}

export interface LearningWiring {
  /** Points the wiring at the bot it should update. Call once, after createPersona. */
  attach: (bot: ConfiguredPersona) => void;
  /** The admin command hooks: !good, !bad, !weights, !dataset, !distill. */
  commands: CommandHooks;
  /** The learned weights for one context, read by the bot for each message. */
  contextWeights: ContextWeightsLookup;
  /** The pipeline observer. Records outcomes and keeps the live bot's weights in step. */
  observer: LearningObserver;
  /** The phrases the persona has used for one topic. */
  topicPhrases: (topic: string) => string[] | undefined;
}

/** Outcomes between saves of the learning state. Ratings and distillation always save. */
export const SAVE_EVERY_OUTCOMES = 10;

/** The LEARNING_* settings from config.ts. */
export interface LearningTuning {
  LEARNING_DISTILL_EVERY: number;
  LEARNING_MAX_PATCH: number;
  LEARNING_STEP: number;
  LEARNING_WARMUP: number;
}

export interface LearningOptions {
  config: LearningTuning;
  /** Without a sink, !dataset says so and leaves the pending entries alone. */
  dataset?: DatasetSink | undefined;
  logger?:
    | { warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void }
    | undefined;
  store: LearningStore;
}

/** Builds learning for the example app. The engine tunes weights; the wiring applies them. */
export async function createLearningWiring(
  opts: LearningOptions
): Promise<LearningWiring> {
  let bot: ConfiguredPersona | undefined;
  let outcomes = 0;

  const system = await LearningSystem.create({
    engineOptions: {
      distillEvery: opts.config.LEARNING_DISTILL_EVERY,
      maxPatchSize: opts.config.LEARNING_MAX_PATCH,
      step: opts.config.LEARNING_STEP,
      warmup: opts.config.LEARNING_WARMUP,
    },
    // distill() hands the patch here. Applying it updates the prompt and the persona.
    onPatch: (patch: PersonaPatch) => {
      bot?.applyPatch(patch);
    },
    store: opts.store,
  });

  const sync = () => {
    const { prompt, recall } = system.getState();
    bot?.setPromptWeights(prompt);
    bot?.setRecallWeights(recall);
  };

  const save = () =>
    system
      .persist()
      .catch((err: unknown) => opts.logger?.error("learning save failed", err));

  return {
    attach(target) {
      bot = target;
      sync();
    },
    commands: {
      onDataset: async () => {
        if (!opts.dataset) {
          return "No dataset location is configured.";
        }
        const entries = await system.drainDataset();
        if (entries.length === 0) {
          return "No new dataset entries.";
        }
        const where = await opts.dataset.save(entries);
        return `Saved ${entries.length} entries to ${where}.`;
      },
      onDistill: async () => {
        const patch = await system.distill();
        sync();
        return `Distilled: ${patch.facts?.length ?? 0} facts, ${patch.phrases?.length ?? 0} phrases.`;
      },
      onRate: async (chatId, rating, comment) => {
        await system.addRating("", chatId, rating, comment);
        sync();
      },
      onWeights: () => {
        const s = system.getState();
        return JSON.stringify(
          {
            feedback: {
              bad: s.badCount,
              good: s.goodCount,
              total: s.feedbackCount,
            },
            prompt: s.prompt,
            recall: s.recall,
          },
          null,
          2
        );
      },
    },
    contextWeights: (lookup) =>
      resolveContextWeights(system.getState(), lookup),
    observer: {
      recordOutcome(input) {
        system.recordOutcome(input);
        sync();
        outcomes += 1;
        if (outcomes % SAVE_EVERY_OUTCOMES === 0) {
          save();
        }
      },
    },
    topicPhrases: (topic) => system.getState().topicPhrases?.[topic],
  };
}
