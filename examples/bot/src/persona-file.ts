import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Persona, parsePersona } from "@persona/schemas";

/** What a real name in an example becomes. Nothing in the bot's output names a chat member. */
const PLACEHOLDER = "alguém";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Replaces each listed name (whole words only) and any phone number with a placeholder. */
export function redactText(text: string, names: string[]): string {
  let out = text.replace(/\+?\d[\d\s\u00a0-]{7,}\d/gu, PLACEHOLDER);
  for (const name of names) {
    out = out.replace(
      new RegExp(`(?<!\\p{L})${escapeRegex(name)}(?!\\p{L})`, "giu"),
      PLACEHOLDER
    );
  }
  return out;
}

/** Names from the chat export, written by the import step to a git-ignored file next to the persona. */
function loadRedactNames(personaPath: string): string[] {
  const file = join(dirname(personaPath), "redact.json");
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as string[])
    : [];
}

/** The same redaction the persona examples get, for group messages used as recall. */
export function redactorFor(personaPath: string): (text: string) => string {
  const names = loadRedactNames(personaPath);
  return (text) => redactText(text, names);
}

function redactPersona(persona: Persona, names: string[]): Persona {
  if (names.length === 0) {
    return persona;
  }
  const r = (t: string) => redactText(t, names);
  return {
    ...persona,
    exchanges: persona.exchanges?.map((e) => ({
      assistant: r(e.assistant),
      user: r(e.user),
    })),
    facts: persona.facts.map(r),
    phrases: persona.phrases.map(r),
    quotes: persona.quotes.map(r),
    styleGuide: persona.styleGuide ? r(persona.styleGuide) : persona.styleGuide,
  };
}

/** A reply with no real words (only laughter, filler or emoji) carries no voice, so it is not used as an example. */
const FILLER =
  /(?:a+h+a+|h+a+h+a*|k{2,}|n+b+|okok+|rs+|lol|ah o beat|ight|siga)/giu;
const EMOJI = /\p{Extended_Pictographic}/gu;

function hasRealWords(text: string): boolean {
  const words =
    text
      .replace(FILLER, " ")
      .replace(EMOJI, " ")
      .match(/[\p{L}]{2,}/gu) ?? [];
  return words.length >= 2;
}

/** European Portuguese markers in the chat (tu, estás, gajo, fixe, bué). Brazilian forms are not counted. */
const EUROPEAN = /\b(?:tu|tens|estás|gajo|gaja|fixe|bué|miúdo|pá)\b/giu;

function europeanScore(text: string): number {
  return (text.match(EUROPEAN) ?? []).length;
}

/**
 * Keeps only example exchanges whose reply has real words, so the model copies voice, not laughter.
 * European Portuguese examples come first, since the persona writes in pt-PT.
 */
export function curatePersona(persona: Persona): Persona {
  const exchanges = (persona.exchanges ?? [])
    .filter((e) => hasRealWords(e.assistant))
    .sort((a, b) => europeanScore(b.assistant) - europeanScore(a.assistant));
  return {
    ...persona,
    exchanges,
    languageHint: "European Portuguese (pt-PT), as spoken in Portugal",
  };
}

/** Reads and validates a persona JSON file from disk (Node or Bun). */
export function loadPersona(path: string): Persona {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `Cannot read persona file ${path}. Copy data/persona.example.json and edit it to create one.`,
      { cause: err }
    );
  }
  return curatePersona(redactPersona(parsePersona(raw), loadRedactNames(path)));
}
