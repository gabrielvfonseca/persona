import type {
  ContextWeights,
  DatasetEntry,
  LearningState,
  PersonaPatch,
} from "@persona/core";
import {
  contextKey,
  defaultContextWeights,
  hourBucket,
  uniqueStrings,
} from "@persona/core";
import type { Outcome } from "./extract";
import { outcomeSignal, userContent, wasReplied } from "./extract";

export interface EngineOptions {
  distillEvery?: number;
  maxPatchSize?: number;
  /** Outcomes kept for distillation and the dataset until drained. Oldest are dropped. */
  maxPending?: number;
  /** Ratings kept in the learning state. Oldest are dropped. */
  maxRatings?: number;
  step?: number;
  warmup?: number;
}

/** One distilled persona patch, ready to apply. */
export interface DistillResult {
  patch: PersonaPatch;
  state: LearningState;
}

/** Senders whose boost is tracked. Oldest are evicted past this. */
const MAX_SENDER_BOOSTS = 50;
const SENDER_BOOST_MIN = 0.2;
const SENDER_BOOST_MAX = 3;
const SENDER_BOOST_UP = 0.05;
const SENDER_BOOST_DOWN = 0.03;

/** Topics that keep their own weights. Oldest are evicted past this. */
const MAX_TOPICS = 200;

/** Replies longer than this are not kept as reusable phrases. */
const MAX_PHRASE_CHARS = 40;

const STYLE_GUIDE_WHEN_BAD =
  "Be concise and on-topic. Avoid speculation and long explanations.";

/**
 * The learning engine. Distillation runs on a cadence and produces a persona
 * patch plus the updated state.
 *
 * Each outcome nudges three weight sets: the global `prompt`/`recall` (which drive
 * the live prompt), the outcome's context (`contexts`), and its two-hour bucket
 * (`hourBuckets`). The sender's boost scales the step for the keyed sets.
 */
export class LearningEngine {
  private readonly state: LearningState;
  private readonly opts: Required<EngineOptions>;
  private pending: Outcome[] = [];
  /** Counts every outcome that moves weights. Drives the distillation cadence. */
  private seen = 0;

  constructor(state: LearningState, opts: EngineOptions = {}) {
    this.state = state;
    this.state.contexts ??= {};
    this.state.hourBuckets ??= {};
    this.state.topics ??= {};
    this.state.senderBoost ??= {};
    this.state.topicPhrases ??= {};
    this.state.schemaVersion ??= 2;
    this.opts = {
      distillEvery: opts.distillEvery ?? 20,
      maxPatchSize: opts.maxPatchSize ?? 5,
      maxPending: opts.maxPending ?? 1000,
      maxRatings: opts.maxRatings ?? 50,
      step: opts.step ?? 0.5,
      warmup: opts.warmup ?? 5,
    };
  }

  getState(): LearningState {
    return this.state;
  }

  /** Feed a pipeline outcome. Returns whether distillation should run. */
  ingestOutcome(outcome: Outcome): boolean {
    const signal = outcomeSignal(outcome);
    this.pending.push(outcome);
    if (this.pending.length > this.opts.maxPending) {
      this.pending = this.pending.slice(-this.opts.maxPending);
    }
    if (signal === 0) {
      return false;
    }
    if (this.warmedUp()) {
      this.moveWeights(signal, outcome);
    }
    this.seen += 1;
    return this.seen % this.opts.distillEvery === 0;
  }

  /** Feed an admin rating (+1 good, -1 bad). Ratings move only the global weights. */
  ingestFeedback(rating: number, chatId = "", comment?: string): void {
    if (!Number.isFinite(rating) || rating === 0) {
      return;
    }
    const signal = rating > 0 ? 1 : -1;
    this.state.ratings = [
      ...this.state.ratings,
      { at: Date.now(), chatId, comment, rating: signal },
    ].slice(-this.opts.maxRatings);
    this.state.feedbackCount += 1;
    if (signal > 0) {
      this.state.goodCount += 1;
    } else {
      this.state.badCount += 1;
    }
    if (this.warmedUp()) {
      nudgeWeights(this.globalWeights(), signal * this.opts.step);
    }
  }

  /** Collect dataset entries from outcomes since the last drain. */
  drainDataset(): DatasetEntry[] {
    const entries = this.pending.flatMap((o): DatasetEntry[] => {
      const reply = o.replyText;
      const user = userContent(o.msg);
      if (!(wasReplied(o) && reply && user.trim())) {
        return [];
      }
      return [
        {
          chatId: o.msg.chatId,
          completion: reply,
          historyTurns: o.historyTurns,
          messages: [...o.historyTurns, { content: user, role: "user" }],
          system: o.systemPrompt,
          timestamp: o.timestamp,
        },
      ];
    });
    this.pending = [];
    return entries;
  }

  /** Run distillation and return the patch + updated state. */
  distill(): DistillResult {
    const patch = this.buildPatch();
    this.state.lastDistillAt = Date.now();
    return { patch, state: this.state };
  }

  /** Nothing moves until `warmup` samples have been seen, counting outcomes and ratings. */
  private warmedUp(): boolean {
    return this.seen + this.state.feedbackCount >= this.opts.warmup;
  }

  private globalWeights(): ContextWeights {
    return { prompt: this.state.prompt, recall: this.state.recall };
  }

  /**
   * Moves the global, context and hour-bucket weights for one outcome. The keyed
   * entries are seeded before the global weights move, so a new entry starts from
   * the values before this outcome and the outcome is applied exactly once.
   */
  private moveWeights(signal: number, outcome: Outcome): void {
    const key = outcome.contextKey ?? contextKey(outcome.msg);
    const bucket = outcome.hourBucket ?? hourBucket(outcome.timestamp);
    const topic = outcome.topicTags?.[0];
    const context = this.keyedWeights("contexts", key);
    const hours = this.keyedWeights("hourBuckets", bucket);
    const byTopic =
      topic === undefined ? undefined : this.keyedWeights("topics", topic);

    nudgeWeights(this.globalWeights(), signal * this.opts.step);
    const keyedStep =
      signal * this.opts.step * this.senderBoostOf(outcome.senderId);
    nudgeWeights(context, keyedStep);
    nudgeWeights(hours, keyedStep);
    if (byTopic) {
      nudgeWeights(byTopic, keyedStep);
    }

    this.updateSenderBoost(outcome.senderId, signal);
  }

  /** Returns the keyed entry, seeding it from the global weights the first time it is seen. */
  private keyedWeights(
    kind: "contexts" | "hourBuckets" | "topics",
    key: string
  ): ContextWeights {
    const map = this.state[kind] ?? {};
    this.state[kind] = map;
    const existing: ContextWeights | undefined = map[key];
    if (existing) {
      return existing;
    }
    // Topics are open-ended, so the oldest one makes room when the map is full.
    const keys = Object.keys(map);
    if (kind === "topics" && keys.length >= MAX_TOPICS) {
      for (const oldest of keys.slice(0, keys.length - MAX_TOPICS + 1)) {
        delete map[oldest];
      }
    }
    const seeded = defaultContextWeights(this.state);
    map[key] = seeded;
    return seeded;
  }

  private senderBoostOf(senderId: string | undefined): number {
    if (senderId === undefined) {
      return 1;
    }
    return this.state.senderBoost?.[senderId] ?? 1;
  }

  /** Hits raise a sender's boost and misses lower it, within a fixed range. */
  private updateSenderBoost(
    senderId: string | undefined,
    signal: number
  ): void {
    if (senderId === undefined) {
      return;
    }
    const boosts = this.state.senderBoost ?? {};
    this.state.senderBoost = boosts;
    const current = boosts[senderId] ?? 1;
    const moved =
      signal > 0 ? current + SENDER_BOOST_UP : current - SENDER_BOOST_DOWN;
    const next = Math.min(SENDER_BOOST_MAX, Math.max(SENDER_BOOST_MIN, moved));
    // Delete before re-inserting, so the most recently active sender sits last.
    delete boosts[senderId];
    boosts[senderId] = Math.round(next * 100) / 100;
    const overflow = Object.keys(boosts).length - MAX_SENDER_BOOSTS;
    for (const oldest of Object.keys(boosts).slice(0, Math.max(0, overflow))) {
      delete boosts[oldest];
    }
  }

  private buildPatch(): PersonaPatch {
    const max = this.opts.maxPatchSize;
    const replies = this.pending
      .flatMap((o) => {
        const text = o.replyText?.trim();
        return wasReplied(o) && text ? [{ outcome: o, text }] : [];
      })
      .slice(-max * 4);

    const facts: string[] = [];
    const phrases: string[] = [];
    const phrasesByTopic = new Map<string, string[]>();
    for (const { outcome, text } of replies) {
      if (userContent(outcome.msg).toLowerCase().includes("who are you")) {
        facts.push(`Answers "who are you" with: ${text}`);
      } else if (outcome.extractedFact) {
        facts.push(outcome.extractedFact);
      }
      if (text.length <= MAX_PHRASE_CHARS && !text.includes("\n")) {
        phrases.push(text);
        const topic = outcome.topicTags?.[0];
        if (topic !== undefined) {
          const list = phrasesByTopic.get(topic) ?? [];
          list.push(text);
          phrasesByTopic.set(topic, list);
        }
      }
    }

    const topicPhrases: Record<string, string[]> = {};
    for (const [topic, texts] of phrasesByTopic) {
      const unique = uniqueStrings(texts).slice(0, max);
      if (unique.length > 0) {
        topicPhrases[topic] = unique;
      }
    }

    const { goodCount, badCount } = this.state;
    const total = goodCount + badCount;
    const mostlyBad = total > 0 && badCount * 2 > total;

    return {
      facts: facts.slice(0, max),
      phrases: phrases.slice(0, max),
      styleGuide: mostlyBad ? STYLE_GUIDE_WHEN_BAD : undefined,
      topicPhrases:
        Object.keys(topicPhrases).length > 0 ? topicPhrases : undefined,
    };
  }
}

/** Moves the prompt and recall weights in place. Keyword recall moves opposite to semantic. */
function nudgeWeights(w: ContextWeights, d: number): void {
  w.prompt.maxWords = clamp(w.prompt.maxWords + d, 1, 40);
  w.prompt.exampleBoost = clamp(w.prompt.exampleBoost + d * 0.5, 0.5, 3);
  w.prompt.styleGuideStrength = clamp(
    w.prompt.styleGuideStrength + d * 0.5,
    0.5,
    3
  );
  w.recall.semanticWeight = clamp(w.recall.semanticWeight + d, 0.1, 5);
  w.recall.keywordWeight = clamp(w.recall.keywordWeight - d * 0.5, 0.1, 5);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
