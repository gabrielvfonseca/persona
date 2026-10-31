import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type Persona, parsePersona } from "@persona/schemas";
import { trainFromExport } from "./train";

/** Fields written by hand. A rebuild keeps them, so ingest never erases work. */
const HAND_WRITTEN = [
  "styleGuide",
  "phrases",
  "facts",
  "languageHint",
] as const;

export interface PersonaFileOptions {
  /** Facts to add. Duplicates of existing facts are dropped. */
  facts?: readonly string[] | undefined;
  name?: string | undefined;
  out: string;
  sender: string;
}

export interface PersonaFileResult {
  exchanges: number;
  factCount: number;
  persona: Persona;
  quotes: number;
}

/**
 * Builds the persona file from a WhatsApp export for one sender. Quotes and
 * example exchanges come from the export. Existing hand-written fields in
 * `out` are kept.
 */
export function writePersonaFile(
  raw: string,
  opts: PersonaFileOptions
): PersonaFileResult {
  const built = trainFromExport(raw, {
    name: opts.name ?? opts.sender,
    sender: opts.sender,
  });
  const persona: Persona = { ...built };

  if (existsSync(opts.out)) {
    try {
      const previous = parsePersona(JSON.parse(readFileSync(opts.out, "utf8")));
      persona.styleGuide = previous.styleGuide;
      persona.phrases = previous.phrases;
      persona.facts = previous.facts;
      persona.languageHint = previous.languageHint;
    } catch {
      // An unreadable previous file is replaced; nothing else is kept from it.
    }
  }

  const facts = [
    ...persona.facts,
    ...(opts.facts ?? []).map((f) => f.trim()),
  ].filter(Boolean);
  persona.facts = [...new Set(facts)];

  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, `${JSON.stringify(persona, null, 2)}\n`);
  return {
    exchanges: persona.exchanges?.length ?? 0,
    factCount: persona.facts.length,
    persona,
    quotes: persona.quotes.length,
  };
}

export { HAND_WRITTEN };
