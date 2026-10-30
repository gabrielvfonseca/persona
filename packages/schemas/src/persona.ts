import { z } from "zod";

export const exchangeSchema = z.object({
  user: z.string(),
  assistant: z.string(),
});

export type Exchange = z.infer<typeof exchangeSchema>;

/** Current persona file format. */
export const personaV1 = z.object({
  version: z.literal(1),
  name: z.string(),
  styleGuide: z.string(),
  languageHint: z.string().optional(),
  stats: z.object({
    medianLen: z.number(),
    p90Len: z.number(),
    messageCount: z.number().optional(),
  }),
  quotes: z.array(z.string()),
  phrases: z.array(z.string()),
  facts: z.array(z.string()),
  /** Real exchanges: what someone said, then how the persona replied. Optional. */
  exchanges: z.array(exchangeSchema).optional(),
});

export type Persona = z.infer<typeof personaV1>;

/**
 * Parses a persona file. Also accepts the legacy `{ profile: {...} }` shape
 * that the first ingest script wrote.
 */
export function parsePersona(raw: unknown): Persona {
  const r = raw as Record<string, unknown> | undefined;
  if (
    r &&
    typeof r === "object" &&
    "profile" in r &&
    r.profile &&
    typeof r.profile === "object"
  ) {
    const p = r.profile as Record<string, unknown>;
    return personaV1.parse({
      version: 1,
      name: p.name ?? "Bot",
      styleGuide: p.styleGuide ?? "",
      languageHint: p.languageHint,
      stats: p.stats ?? { medianLen: 0, p90Len: 0 },
      quotes: p.quotes ?? [],
      phrases: p.phrases ?? [],
      facts: p.facts ?? [],
    });
  }
  return personaV1.parse(raw);
}
