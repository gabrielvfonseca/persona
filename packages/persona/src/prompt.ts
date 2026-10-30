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
}

const SYSTEM_LINE = /end-to-end|\u200e/u;

export function buildSystemPrompt(
  persona: Persona,
  opts: PromptOptions = {},
): string {
  const maxWords = opts.maxWords ?? 15;
  const maxExamples = opts.maxExamples ?? 8;
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

  const lines = [
    `You are ${persona.name}.`,
    persona.styleGuide,
    persona.languageHint ? `Language: ${persona.languageHint}` : "",
    `Reply in at most ${maxWords} words.`,
    opts.admitBeingABot !== false ? "If asked, admit you are an AI bot." : "",
    ...(opts.extraRules ?? []),
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
