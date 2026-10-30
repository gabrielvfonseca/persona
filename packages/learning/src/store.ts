import type { LearningState, PersonaPatch, PromptWeights, RecallWeights } from "@persona/core";

/** Defaults a brand-new learning state. */
export const DEFAULT_PROMPT_WEIGHTS: PromptWeights = {
  maxWords: 15,
  exampleBoost: 1,
  styleGuideStrength: 1,
  extraRules: [],
};

export const DEFAULT_RECALL_WEIGHTS: RecallWeights = {
  keywordWeight: 1,
  semanticWeight: 1,
  rrfK: 60,
};

export function defaultLearningState(): LearningState {
  return {
    prompt: { ...DEFAULT_PROMPT_WEIGHTS },
    recall: { ...DEFAULT_RECALL_WEIGHTS },
    feedbackCount: 0,
    goodCount: 0,
    badCount: 0,
  };
}

/**
 * A simple JSON-backed store. Pass any object that round-trips through JSON
 * and supports `get`/`set`. The in-memory version here is what tests use; the
 * Worker wires it to KV.
 */
export interface LearningStore {
  get(key: string): Promise<string | null | undefined>;
  set(key: string, value: string): void | Promise<void>;
}

const KEY = "learning:state";

export async function loadLearningState(
  store: LearningStore,
): Promise<LearningState> {
  const raw = await store.get(KEY);
  if (!raw) return defaultLearningState();
  try {
    return mergeLearningState(defaultLearningState(), JSON.parse(raw) as Partial<LearningState>);
  } catch {
    return defaultLearningState();
  }
}

export async function saveLearningState(
  store: LearningStore,
  state: LearningState,
): Promise<void> {
  await store.set(KEY, JSON.stringify(state));
}

/** Fills missing fields from `defaults` without overwriting present ones. */
export function mergeLearningState(
  defaults: LearningState,
  patch: Partial<LearningState>,
): LearningState {
  return {
    prompt: { ...defaults.prompt, ...patch.prompt },
    recall: { ...defaults.recall, ...patch.recall },
    feedbackCount: patch.feedbackCount ?? defaults.feedbackCount,
    goodCount: patch.goodCount ?? defaults.goodCount,
    badCount: patch.badCount ?? defaults.badCount,
    lastDistillAt: patch.lastDistillAt ?? defaults.lastDistillAt,
  };
}

/** Clamp a number to a range and round to a step. */
function clamp(value: number, min: number, max: number, step: number): number {
  const clamped = Math.max(min, Math.min(max, value));
  return Math.round(clamped / step) * step;
}

/** Apply a persona patch to a persona, returning a new one. */
export function applyPatch(
  patch: PersonaPatch,
  target: { facts: string[]; phrases: string[]; styleGuide: string },
): { facts: string[]; phrases: string[]; styleGuide: string } {
  const facts = unique([...target.facts, ...(patch.facts ?? [])]);
  const phrases = unique([...target.phrases, ...(patch.phrases ?? [])]);
  const styleGuide = patch.styleGuide
    ? [target.styleGuide, patch.styleGuide].filter(Boolean).join("\n\n")
    : target.styleGuide;
  return { facts, phrases, styleGuide };
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