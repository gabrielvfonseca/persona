import type {
  ContextWeights,
  LearningState,
  PersonaPatch,
  PromptWeights,
  RatingEntry,
  RecallWeights,
} from "@persona/core";
import { uniqueStrings } from "@persona/core";

/** Defaults a brand-new learning state. */
export const DEFAULT_PROMPT_WEIGHTS: PromptWeights = {
  exampleBoost: 1,
  extraRules: [],
  maxWords: 15,
  styleGuideStrength: 1,
};

export const DEFAULT_RECALL_WEIGHTS: RecallWeights = {
  keywordWeight: 1,
  rrfK: 60,
  semanticWeight: 1,
};

export const LEARNING_SCHEMA_VERSION = 2;

export function defaultLearningState(): LearningState {
  return {
    badCount: 0,
    contexts: {},
    feedbackCount: 0,
    goodCount: 0,
    hourBuckets: {},
    prompt: { ...DEFAULT_PROMPT_WEIGHTS, extraRules: [] },
    ratings: [],
    recall: { ...DEFAULT_RECALL_WEIGHTS },
    schemaVersion: LEARNING_SCHEMA_VERSION,
    senderBoost: {},
    topicPhrases: {},
    topics: {},
  };
}

/**
 * A simple JSON-backed store. Pass any object that round-trips through JSON
 * and supports `get`/`set`. The in-memory version here is what tests use; the
 * Worker wires it to KV.
 */
export interface LearningStore {
  get: (key: string) => Promise<string | null | undefined>;
  set: (key: string, value: string) => void | Promise<void>;
}

const KEY = "learning:state";

export async function loadLearningState(
  store: LearningStore
): Promise<LearningState> {
  const raw = await store.get(KEY);
  if (!raw) {
    return defaultLearningState();
  }
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return defaultLearningState();
  }
  return mergeLearningState(defaultLearningState(), stored);
}

export async function saveLearningState(
  store: LearningStore,
  state: LearningState
): Promise<void> {
  await store.set(KEY, JSON.stringify(state));
}

/**
 * Builds a full state from a value read from storage. Anything missing or of
 * the wrong type falls back to `defaults`, so old (v1) and partial states load.
 */
export function mergeLearningState(
  defaults: LearningState,
  stored: unknown
): LearningState {
  const s = isRecord(stored) ? stored : {};
  const prompt = readPrompt(s.prompt, defaults.prompt);
  const recall = readRecall(s.recall, defaults.recall);
  return {
    badCount: num(s.badCount) ?? defaults.badCount,
    contexts: {
      ...defaults.contexts,
      ...readContextMap(s.contexts, defaults),
    },
    feedbackCount: num(s.feedbackCount) ?? defaults.feedbackCount,
    goodCount: num(s.goodCount) ?? defaults.goodCount,
    hourBuckets: {
      ...defaults.hourBuckets,
      ...readContextMap(s.hourBuckets, defaults),
    },
    lastDistillAt: num(s.lastDistillAt) ?? defaults.lastDistillAt,
    prompt,
    ratings: readRatings(s.ratings) ?? defaults.ratings,
    recall,
    schemaVersion: num(s.schemaVersion) ?? LEARNING_SCHEMA_VERSION,
    senderBoost: { ...defaults.senderBoost, ...readNumberMap(s.senderBoost) },
    topicPhrases: {
      ...defaults.topicPhrases,
      ...readStringListMap(s.topicPhrases),
    },
    topics: {
      ...defaults.topics,
      ...readContextMap(s.topics, defaults),
    },
  };
}

/** Applies a persona patch to a persona's facts, phrases, style guide and topic phrases. */
export function applyPatch(
  patch: PersonaPatch,
  target: {
    facts: string[];
    phrases: string[];
    styleGuide: string;
    topicPhrases?: Record<string, string[]> | undefined;
  }
): {
  facts: string[];
  phrases: string[];
  styleGuide: string;
  topicPhrases?: Record<string, string[]> | undefined;
} {
  const facts = uniqueStrings([...target.facts, ...(patch.facts ?? [])]);
  const phrases = uniqueStrings([...target.phrases, ...(patch.phrases ?? [])]);
  const styleGuide = patch.styleGuide
    ? [target.styleGuide, patch.styleGuide].filter(Boolean).join("\n\n")
    : target.styleGuide;
  const topicPhrases = patch.topicPhrases
    ? mergeTopicPhrases(target.topicPhrases ?? {}, patch.topicPhrases)
    : target.topicPhrases;
  return { facts, phrases, styleGuide, topicPhrases };
}

function mergeTopicPhrases(
  base: Record<string, string[]>,
  extra: Record<string, string[]>
): Record<string, string[]> {
  const merged: Record<string, string[]> = { ...base };
  for (const [topic, phrases] of Object.entries(extra)) {
    merged[topic] = uniqueStrings([...(merged[topic] ?? []), ...phrases]);
  }
  return merged;
}

// ---- Runtime readers: each takes `unknown` and returns a typed value or a fallback.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((v): v is string => typeof v === "string");
}

function readPrompt(value: unknown, base: PromptWeights): PromptWeights {
  const v = isRecord(value) ? value : {};
  return {
    exampleBoost: num(v.exampleBoost) ?? base.exampleBoost,
    extraRules: strings(v.extraRules) ?? base.extraRules,
    maxWords: num(v.maxWords) ?? base.maxWords,
    styleGuideStrength: num(v.styleGuideStrength) ?? base.styleGuideStrength,
  };
}

function readRecall(value: unknown, base: RecallWeights): RecallWeights {
  const v = isRecord(value) ? value : {};
  return {
    keywordWeight: num(v.keywordWeight) ?? base.keywordWeight,
    rrfK: num(v.rrfK) ?? base.rrfK,
    semanticWeight: num(v.semanticWeight) ?? base.semanticWeight,
  };
}

/** Keyed weight sets. Missing parts are filled from the global prompt and recall weights. */
function readContextMap(
  value: unknown,
  base: LearningState
): Record<string, ContextWeights> {
  if (!isRecord(value)) {
    return {};
  }
  const out: Record<string, ContextWeights> = {};
  for (const [key, entry] of Object.entries(value)) {
    const e = isRecord(entry) ? entry : {};
    out[key] = {
      prompt: readPrompt(e.prompt, base.prompt),
      recall: readRecall(e.recall, base.recall),
    };
  }
  return out;
}

function readNumberMap(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    const n = num(entry);
    if (n !== undefined) {
      out[key] = n;
    }
  }
  return out;
}

function readStringListMap(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) {
    return {};
  }
  const out: Record<string, string[]> = {};
  for (const [key, entry] of Object.entries(value)) {
    const list = strings(entry);
    if (list) {
      out[key] = list;
    }
  }
  return out;
}

function readRatings(value: unknown): RatingEntry[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.flatMap((entry): RatingEntry[] => {
    if (!isRecord(entry)) {
      return [];
    }
    const rating = num(entry.rating);
    const at = num(entry.at);
    if (
      typeof entry.chatId !== "string" ||
      rating === undefined ||
      at === undefined
    ) {
      return [];
    }
    return [
      {
        at,
        chatId: entry.chatId,
        comment: typeof entry.comment === "string" ? entry.comment : undefined,
        rating,
      },
    ];
  });
}
