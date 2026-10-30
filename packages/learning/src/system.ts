import type {
  DatasetEntry,
  HandleResult,
  IncomingMessage,
  LearningObserver,
  LearningState,
  PersonaPatch,
  Turn,
} from "@persona/core";
import { LearningEngine } from "./engine";
import { loadLearningState, saveLearningState } from "./store";
import type { LearningStore } from "./store";
import { outcomeSignal, wasReplied } from "./extract";
import type { Outcome } from "./extract";

export interface LearningSystemOptions {
  store: LearningStore;
  engine?: LearningEngine | undefined;
  onPatch?: ((patch: PersonaPatch) => void | Promise<void>) | undefined;
  onDataset?: ((entries: DatasetEntry[]) => void | Promise<void>) | undefined;
}

/**
 * Wires the engine to the pipeline. `observe` is the LearningObserver the SDK
 * calls after every handled message. `rate` is the FeedbackSink admins use.
 */
export class LearningSystem implements LearningObserver {
  readonly engine: LearningEngine;
  private readonly store: LearningStore;
  private readonly onPatch?: (patch: PersonaPatch) => void | Promise<void>;
  private readonly onDataset?: (entries: DatasetEntry[]) => void | Promise<void>;
  private state: LearningState;
  private initialized = false;

  private constructor(
    engine: LearningEngine,
    state: LearningState,
    store: LearningStore,
    opts: LearningSystemOptions,
  ) {
    this.engine = engine;
    this.state = state;
    this.store = store;
    this.onPatch = opts.onPatch;
    this.onDataset = opts.onDataset;
  }

  static async create(opts: LearningSystemOptions): Promise<LearningSystem> {
    const state = await loadLearningState(opts.store);
    const engine = opts.engine ?? new LearningEngine(state);
    const sys = new LearningSystem(engine, state, store, opts);
    sys.initialized = true;
    return sys;
  }

  recordOutcome(input: {
    msg: IncomingMessage;
    result: HandleResult;
    systemPrompt: string;
    historyTurns: Turn[];
    recallLines: string[];
    replyText?: string | undefined;
  }): void {
    const outcome: Outcome = {
      ...input,
      timestamp: Date.now(),
    };
    const shouldDistill = this.engine.ingestOutcome(outcome);
    if (shouldDistill) {
      this.distill().catch(() => {});
    }
  }

  async addRating(
    replyId: string,
    chatId: string,
    rating: number,
    comment?: string,
  ): Promise<void> {
    void replyId;
    void chatId;
    void comment;
    this.engine.ingestFeedback(rating);
    await this.persist();
  }

  /** Drain the fine-tune dataset and notify the callback. */
  async drainDataset(): Promise<DatasetEntry[]> {
    const entries = this.engine.drainDataset();
    if (entries.length && this.onDataset) {
      await this.onDataset(entries);
    }
    return entries;
  }

  /** Run distillation, apply the patch, and persist. */
  async distill(): Promise<PersonaPatch> {
    const { patch } = this.engine.distill();
    this.state = this.engine.getState();
    if (this.onPatch) await this.onPatch(patch);
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

/** A LearningObserver that does nothing. Useful when learning is off. */
export const noopLearningObserver: LearningObserver = {
  recordOutcome: () => {},
};

/** A FeedbackSink that does nothing. */
export const noopFeedbackSink = {
  addRating: () => Promise.resolve(),
};