import { z } from "zod";

export const exchangeSchema = z.object({
  assistant: z.string(),
  user: z.string(),
});

export type Exchange = z.infer<typeof exchangeSchema>;

/** Current persona file format. */
export const personaV1 = z.object({
  /** Real exchanges: what someone said, then how the persona replied. Optional. */
  exchanges: z.array(exchangeSchema).optional(),
  facts: z.array(z.string()),
  languageHint: z.string().optional(),
  name: z.string(),
  phrases: z.array(z.string()),
  quotes: z.array(z.string()),
  stats: z.object({
    medianLen: z.number(),
    messageCount: z.number().optional(),
    p90Len: z.number(),
  }),
  styleGuide: z.string(),
  version: z.literal(1),
});

export type Persona = z.infer<typeof personaV1>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses a persona file. Also accepts the legacy `{ profile: {...} }` shape
 * that older tooling wrote.
 */
export function parsePersona(raw: unknown): Persona {
  if (isRecord(raw) && isRecord(raw.profile)) {
    const p = raw.profile;
    return personaV1.parse({
      facts: p.facts ?? [],
      languageHint: p.languageHint,
      name: p.name ?? "Bot",
      phrases: p.phrases ?? [],
      quotes: p.quotes ?? [],
      stats: p.stats ?? { medianLen: 0, p90Len: 0 },
      styleGuide: p.styleGuide ?? "",
      version: 1,
    });
  }
  return personaV1.parse(raw);
}
