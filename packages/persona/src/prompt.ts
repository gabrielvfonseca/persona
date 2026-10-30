import type { PromptWeights } from "@persona/core";
import type { Persona } from "@persona/schemas";

export interface PromptOptions {
  maxWords?: number | undefined;
  platform?: string | undefined;
  admitBeingABot?: boolean | undefined;
  extraRules?: string[] | undefined;
  maxExamples?: number | undefined;
  maxExampleChars?: number | undefined;
  /** Real exchanges shown to the model as examples. */
  maxExchanges?: number | undefined;
  maxExchangeChars?: number | undefined;
  /** Tunable weights, adjusted by the learning engine. */
  weights?: PromptWeights | undefined;
}

const SYSTEM_LINE = /end-to-end|\u200e/u;

/**
 * Builds the system prompt. `weights` lets the learning engine tune the prompt
 * at runtime without rebuilding the persona.
 */
export function buildSystemPrompt(
  persona: Persona,
  opts: PromptOptions = {},
): string {
  const weights = opts.weights ?? {
    maxWords: 15,
    exampleBoost: 1,
    styleGuideStrength: 1,
    extraRules: [],
  };
  const maxWords = weights.maxWords;
  const maxExamples = Math.max(
    1,
    Math.round((opts.maxExamples ?? 8) * weights.exampleBoost),
  );
  const maxExampleChars = opts.maxExampleChars ?? 80;
  const maxExchanges = opts.maxExchanges ?? 6;
  const maxExchangeChars = opts.maxExchangeChars ?? 160;
  const examples = persona.quotes
    .filter(
      (q) => q.trim() && q.length <= maxExampleChars && !SYSTEM_LINE.test(q),
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
        !SYSTEM_LINE.test(e.user + e.assistant),
    )
    .slice(0, maxExchanges);

  const styleGuide = persona.styleGuide
    ? weights.styleGuideStrength >= 1
      ? persona.styleGuide
      : persona.styleGuide
          .split(/\n+/)
          .slice(0, Math.ceil(persona.styleGuide.split(/\n+/).length * weights.styleGuideStrength))
          .join("\n")
    : "";

  const lines = [
    `You are ${persona.name}.`,
    styleGuide,
    persona.languageHint ? `Language: ${persona.languageHint}` : "",
    `Reply in at most ${maxWords} words.`,
    opts.admitBeingABot !== false ? "If asked, admit you are an AI bot." : "",
    ...(opts.extraRules ?? []),
    ...(weights.extraRules ?? []),
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
    ...(persona.facts.length
      ? ["Facts:", ...persona.facts.map((f) => `- ${f}`)]
      : []),
  ];
  return lines
    .filter(Boolean)
    .join("\n")
    .replace(/\u200e/g, "");
}
