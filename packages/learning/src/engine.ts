import type {
  DatasetEntry,
  IncomingMessage,
  LearningState,
  PersonaPatch,
  PromptWeights,
  RecallWeights,
  Turn,
} from "@persona/core";
import type { Outcome } from "./extract";
import { outcomeSignal, wasReplied } from "./extract";

export interface EngineOptions {
  /** Minimum signal count before weights start moving. */
  warmup?: number | undefined;
  /** Step size for weight nudges. */
  step?: number | undefined;
  /** How often to run distillation (every N outcomes). */
  distillEvery?: number | undefined;
  /** Max facts/phrases to keep in a patch. */
  maxPatchSize?: number | undefined;
  /** Random source, for tests. */
  random?: () => number | undefined;
}

const DEFAULTS: Required<EngineOptions> = {
  warmup: 5,
  step: 0.5,
  distillEvery: 20,
  maxPatchSize: 5,
  random: Math.random,
};

/** One distilled persona patch, ready to apply. */
export interface DistillResult {
  patch: PersonaPatch;
  state: LearningState;
}

/**
 * The learning engine. It is stateless between calls except for the counters it
 * mutates on `ingestOutcome`/`ingestFeedback`. Distillation runs on a cadence
 * and produces a persona patch plus the updated state.
 */
export class LearningEngine {
  private state: LearningState;
  private readonly opts: Required<EngineOptions>;
  private pending: Outcome[] = [];

  constructor(state: LearningState, opts: EngineOptions = {}) {
    this.state = state;
    this.opts = { ...DEFAULTS, ...opts };
  }

  getState(): LearningState {
    return this.state;
  }

  /** Feed a pipeline outcome. Returns whether distillation should run. */
  ingestOutcome(outcome: Outcome): boolean {
    const signal = outcomeSignal(outcome);
    this.pending.push(outcome);
    if (signal === 0) return false;
    this.adjustWeights(signal);
    return this.pending.length % this.opts.distillEvery === 0;
  }

  /** Feed an admin rating (+1 good, -1 bad). */
  ingestFeedback(rating: number): void {
    const signal = rating > 0 ? 1 : rating < 0 ? -1 : 0;
    if (signal === 0) return;
    this.state.feedbackCount += 1;
    if (signal > 0) this.state.goodCount += 1;
    else this.state.badCount += 1;
    this.adjustWeights(signal);
  }

  /** Collect dataset entries from outcomes since the last drain. */
  drainDataset(): DatasetEntry[] {
    const entries: DatasetEntry[] = [];
    for (const o of this.pending) {
      if (!wasReplied(o) || !o.replyText) continue;
      const user = userContent(o.msg);
      if (!user.trim()) continue;
      entries.push({
        completion: o.replyText,
        chatId: o.msg.chatId,
        historyTurns: o.historyTurns,
        messages: [...o.historyTurns, { content: user, role: "user" }],
        system: o.systemPrompt,
        timestamp: o.timestamp,
      });
    }
    this.pending = [];
    return entries;
  }

  /** Run distillation and return the patch + updated state. */
  distill(): DistillResult {
    const patch = this.buildPatch();
    this.state.lastDistillAt = Date.now();
    return { patch, state: this.state };
  }

  private adjustWeights(signal: 1 | -1): void {
    const s = this.state;
    const step = this.opts.step;
    const samples = s.feedbackCount + s.goodCount + s.badCount;
    if (samples < this.opts.warmup) return;

    const direction = signal;
    // Prompt weights move against the signal: good replies -> allow longer,
    // more examples; bad replies -> tighten.
    s.prompt.maxWords = clamp(
      s.prompt.maxWords + direction * step,
      1,
      40,
      1,
    );
    s.prompt.exampleBoost = clamp(
      s.prompt.exampleBoost + direction * step * 0.5,
      0.5,
      3,
      0.5,
    );
    s.prompt.styleGuideStrength = clamp(
      s.prompt.styleGuideStrength + direction * step * 0.5,
      0.5,
      3,
      0.5,
    );

    // Recall weights: good outcomes boost semantic search, bad outcomes lean
    // on keywords (which are more predictable).
    s.recall.semanticWeight = clamp(
      s.recall.semanticWeight + direction * step,
      0.1,
      5,
      0.1,
    );
    s.recall.keywordWeight = clamp(
      s.recall.keywordWeight - direction * step * 0.5,
      0.1,
      5,
      0.1,
    );
  }

  private buildPatch(): PersonaPatch {
    const patch: PersonaPatch = {};
    const facts: string[] = [];
    const phrases: string[] = [];
    const max = this.opts.maxPatchSize;

    // Pull the most recent good replies as candidate facts and phrases.
    const good = this.pending
      .filter((o) => wasReplied(o) && o.replyText)
      .slice(-max);
    for (const o of good) {
      const text = o.replyText?.trim();
      if (!text) continue;
      const user = userContent(o.msg);
      if (user.toLowerCase().includes("who are you")) {
        facts.push(`Answers "who are you" with: ${text}`);
      } else if (text.length <= 40 && !text.includes("\n")) {
        phrases.push(text);
      }
    }
    patch.facts = facts.slice(0, max);
    patch.phrases = phrases.slice(0, max);

    // Style guide: when bad outcomes dominate, tighten the style guide.
    const total = this.state.goodCount + this.state.badCount;
    if (total > 0 && this.state.badCount / total > 0.5) {
      patch.styleGuide =
        "Be concise and on-topic. Avoid speculation and long explanations.";
    }
    return patch;
  }
}

function userContent(msg: IncomingMessage): string {
  return msg.isGroup && msg.senderName
    ? `${msg.senderName}: ${msg.text}`
    : msg.text;
}

function clamp(value: number, min: number, max: number, step: number): number {
  const clamped = Math.max(min, Math.min(max, value));
  return Math.round(clamped / step) * step;
}