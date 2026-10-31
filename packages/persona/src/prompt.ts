import type { LearningState, PromptWeights } from "@persona/core";
import type { Persona } from "@persona/schemas";

const PATTERN_1 = /\n+/u;
const PATTERN_3 = /\u200e/gu;

export interface PromptOptions {
  admitBeingABot?: boolean | undefined;
  extraRules?: string[] | undefined;
  maxExampleChars?: number | undefined;
  maxExamples?: number | undefined;
  maxExchangeChars?: number | undefined;
  /** Real exchanges shown to the model as examples. */
  maxExchanges?: number | undefined;
  maxWords?: number | undefined;
  platform?: string | undefined;
  /** Short replies the persona has used for the current topic. Shown as a hint. */
  topicPhrases?: string[] | undefined;
  /** Tunable weights, adjusted by the learning engine. */
  weights?: PromptWeights | undefined;
}

/** Topic phrases shown per prompt. Keeps the hint short. */
const MAX_TOPIC_PHRASES = 5;

const SYSTEM_LINE = /end-to-end|\u200e/u;

/**
 * The prompt weights for one context (`dm`, `group:4`, …), falling back to the
 * global weights when the context has none yet.
 */
export function selectPromptWeights(
  state: LearningState,
  key: string
): PromptWeights {
  return state.contexts?.[key]?.prompt ?? state.prompt;
}

/**
 * Builds the system prompt. `weights` lets the learning engine tune the prompt
 * at runtime without rebuilding the persona.
 */
export function buildSystemPrompt(
  persona: Persona,
  opts: PromptOptions = {}
): string {
  const weights: PromptWeights = opts.weights ?? {
    exampleBoost: 1,
    extraRules: [],
    maxWords: opts.maxWords ?? 15,
    styleGuideStrength: 1,
  };
  // Learned weights are fractional so small nudges accumulate; the prompt shows whole words.
  const maxWords = Math.max(1, Math.round(weights.maxWords));
  const maxExamples = Math.max(
    1,
    Math.round((opts.maxExamples ?? 8) * weights.exampleBoost)
  );
  const maxExampleChars = opts.maxExampleChars ?? 80;
  const maxExchanges = opts.maxExchanges ?? 6;
  const maxExchangeChars = opts.maxExchangeChars ?? 160;
  const examples = persona.quotes
    .filter(
      (q) => q.trim() && q.length <= maxExampleChars && !SYSTEM_LINE.test(q)
    )
    .slice(0, maxExamples)
    .map((q) => q.slice(0, maxExampleChars));
  const exchanges = (persona.exchanges ?? [])
    .filter(
      (e) =>
        e.user.trim() &&
        e.assistant.trim() &&
        e.user.length <= maxExchangeChars &&
        e.assistant.length <= maxExchangeChars &&
        !SYSTEM_LINE.test(e.user + e.assistant)
    )
    .slice(0, maxExchanges);

  const styleGuide = persona.styleGuide
    ? trimStyleGuide(persona.styleGuide, weights.styleGuideStrength)
    : "";

  const lines = [
    `You are ${persona.name}.`,
    styleGuide,
    persona.languageHint ? `Language: ${persona.languageHint}` : "",
    `Reply in at most ${maxWords} words.`,
    opts.admitBeingABot === false ? "" : "If asked, admit you are an AI bot.",
    ...(opts.extraRules ?? []),
    ...weights.extraRules,
    "Examples:",
    ...examples.map((e) => `- ${e}`),
    ...(exchanges.length
      ? [
          "Example exchanges (reply in this voice):",
          ...exchanges.flatMap((e) => [
            `User: ${e.user}`,
            `You: ${e.assistant}`,
          ]),
        ]
      : []),
    ...(persona.phrases.length
      ? ["Phrases:", ...persona.phrases.map((p) => `- ${p}`)]
      : []),
    ...topicHint(opts.topicPhrases),
    ...(persona.facts.length
      ? ["Facts:", ...persona.facts.map((f) => `- ${f}`)]
      : []),
  ];
  return lines.filter(Boolean).join("\n").replace(PATTERN_3, "");
}

function topicHint(phrases: string[] | undefined): string[] {
  const shown = (phrases ?? []).slice(0, MAX_TOPIC_PHRASES);
  return shown.length
    ? ["Replies you have used for this topic:", ...shown.map((p) => `- ${p}`)]
    : [];
}

/** Keeps the first share of a style guide's lines, scaled by how strongly the learner weights it. */
function trimStyleGuide(guide: string, strength: number): string {
  if (strength >= 1) {
    return guide;
  }
  const lines = guide.split(PATTERN_1);
  return lines.slice(0, Math.ceil(lines.length * strength)).join("\n");
}
