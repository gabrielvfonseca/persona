import type {
  DatasetEntry,
  LearningObserver,
  LearningState,
  OutcomeInput,
  PersonaPatch,
} from "@persona/core";
import { computeTopicTags, contextKey, hourBucket } from "@persona/core";
import { type EngineOptions, LearningEngine } from "./engine";
import type { Outcome } from "./extract";
import { computeRepeatScore, computeTone } from "./extract";
import type { LearningStore } from "./store";
import { loadLearningState, saveLearningState } from "./store";

export interface LearningSystemOptions {
  /**
   * An engine that already holds the state you want. Prefer `engineOptions`,
   * which builds the engine from the saved state.
   */
  engine?: LearningEngine | undefined;
  /** Tuning for the engine. The engine starts from the saved state, not from defaults. */
  engineOptions?: EngineOptions | undefined;
  /** Persona quotes, used to penalise replies that repeat them. */
  examples?: string[] | undefined;
  onDataset?: ((entries: DatasetEntry[]) => void | Promise<void>) | undefined;
  onPatch?: ((patch: PersonaPatch) => void | Promise<void>) | undefined;
  /** Persona length stats, used to score how close a reply is to the usual length. */
  personaStats?: { medianLen: number } | undefined;
  store: LearningStore;
}

/**
 * Wires the engine to the pipeline. `observe` is the LearningObserver the SDK
 * calls after every handled message. `rate` is the FeedbackSink admins use.
 */
export class LearningSystem implements LearningObserver {
  readonly engine: LearningEngine;
  private readonly store: LearningStore;
  private readonly onPatch: (patch: PersonaPatch) => void | Promise<void>;
  private readonly onDataset: (entries: DatasetEntry[]) => void | Promise<void>;
  private readonly personaStats?: { medianLen: number } | undefined;
  private readonly examples?: string[] | undefined;

  private constructor(
    engine: LearningEngine,
    store: LearningStore,
    opts: LearningSystemOptions
  ) {
    this.engine = engine;
    this.store = store;
    this.onPatch = opts.onPatch ?? noopPatch;
    this.onDataset = opts.onDataset ?? noopDataset;
    this.personaStats = opts.personaStats;
    this.examples = opts.examples;
  }

  static async create(opts: LearningSystemOptions): Promise<LearningSystem> {
    const state = await loadLearningState(opts.store);
    const engine =
      opts.engine ?? new LearningEngine(state, opts.engineOptions ?? {});
    return new LearningSystem(engine, opts.store, opts);
  }

  recordOutcome(input: OutcomeInput): void {
    const timestamp = Date.now();
    // persona.stats.medianLen is measured in characters, so the reply is too.
    const stats = input.personaStats ?? this.personaStats;
    const chars = input.replyText?.trim().length ?? 0;
    const lengthRatio =
      stats && stats.medianLen > 0 && chars > 0
        ? chars / stats.medianLen
        : undefined;
    // Quality terms only describe a reply that was actually sent.
    const reply =
      input.result.kind === "replied" && input.replyText
        ? input.replyText
        : undefined;
    const outcome: Outcome = {
      contextKey: input.contextKey ?? contextKey(input.msg),
      // Never learn a fact from the bot's own reply: that would store invented
      // answers as facts and feed them back into the prompt. Facts come only from
      // the persona file and from admins.
      extractedFact: undefined,
      historyTurns: input.historyTurns,
      hourBucket: input.hourBucket ?? hourBucket(timestamp),
      lengthRatio,
      msg: input.msg,
      recallLines: input.recallLines,
      repeatScore:
        reply === undefined
          ? undefined
          : computeRepeatScore(reply, input.examples ?? this.examples ?? []),
      replyText: input.replyText,
      result: input.result,
      senderId: input.senderId ?? input.msg.senderId,
      systemPrompt: input.systemPrompt,
      timestamp,
      tone: reply === undefined ? undefined : computeTone(reply),
      // Topics come from what the user said, so replies group under the question they answered.
      topicTags:
        reply === undefined ? undefined : computeTopicTags(input.msg.text),
      transformed: input.transformed,
    };
    if (this.engine.ingestOutcome(outcome)) {
      this.distill().catch(() => {
        /* intentionally empty */
      });
    }
  }

  async addRating(
    _replyId: string,
    chatId: string,
    rating: number,
    comment?: string
  ): Promise<void> {
    this.engine.ingestFeedback(rating, chatId, comment);
    await this.persist();
  }

  /** Drain the fine-tune dataset and notify the callback. */
  async drainDataset(): Promise<DatasetEntry[]> {
    const entries = this.engine.drainDataset();
    if (entries.length) {
      await this.onDataset(entries);
    }
    return entries;
  }

  /** Run distillation, apply the patch, and persist. */
  async distill(): Promise<PersonaPatch> {
    const { patch } = this.engine.distill();
    await this.onPatch(patch);
    await this.persist();
    return patch;
  }

  /** Persist the current state. Fire-and-forget safe. */
  persist(): Promise<void> {
    return saveLearningState(this.store, this.engine.getState());
  }

  getState(): LearningState {
    return this.engine.getState();
  }
}

function noopPatch(_patch: PersonaPatch): void {
  /* intentionally empty */
}

function noopDataset(_entries: DatasetEntry[]): void {
  /* intentionally empty */
}

/** A LearningObserver that does nothing. Useful when learning is off. */
export const noopLearningObserver: LearningObserver = {
  recordOutcome: () => undefined,
};

/** A FeedbackSink that does nothing. */
export const noopFeedbackSink = {
  addRating: () => Promise.resolve(),
};
