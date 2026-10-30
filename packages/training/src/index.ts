import type { Persona } from "@persona/schemas";
import { buildPersona } from "./build-persona";
import { parseExport, segment } from "./parse-export";

export interface TrainOptions {
  /** Exact sender name as it appears in the export. */
  sender: string;
  /** Persona display name. Defaults to `sender`. */
  name?: string | undefined;
  maxQuotes?: number | undefined;
  maxQuoteChars?: number | undefined;
  maxExchanges?: number | undefined;
  maxExchangeChars?: number | undefined;
}

/**
 * Turns a raw chat export into a persona file for one sender.
 * Quotes and example exchanges come from the export. Hand-written fields
 * (styleGuide, phrases, facts) start empty.
 */
export function trainFromExport(raw: string, opts: TrainOptions): Persona {
  const messages = segment(parseExport(raw));
  return buildPersona({ messages, ...opts });
}

/** A turn in a fine-tune dataset. */
export interface DatasetTurn {
  role: "user" | "assistant";
  content: string;
}

/** One entry in the fine-tune dataset. */
export interface DatasetSample {
  system: string;
  messages: DatasetTurn[];
  completion: string;
  chatId: string;
  timestamp: number;
}

/**
 * Collects fine-tune samples from a list of persona interactions.
 * `samples` is appended to; the persona is rebuilt from the export each time.
 */
export function collectDataset(
  exports: readonly string[],
  senders: readonly string[],
  samples: DatasetSample[] = [],
): DatasetSample[] {
  for (const raw of exports) {
    const messages = segment(parseExport(raw));
    for (const sender of senders) {
      const persona = buildPersona({ messages, sender, name: sender });
      const system = personaToSystem(persona);
      const exchanges = persona.exchanges ?? [];
      for (const ex of exchanges) {
        samples.push({
          system,
          messages: [
            { role: "user", content: ex.user },
            { role: "assistant", content: ex.assistant },
          ],
          completion: ex.assistant,
          chatId: sender,
          timestamp: Date.now(),
        });
      }
    }
  }
  return samples;
}

function personaToSystem(persona: Persona): string {
  const lines = [
    `You are ${persona.name}.`,
    persona.styleGuide,
    persona.languageHint ? `Language: ${persona.languageHint}` : "",
    "Examples:",
    ...persona.quotes.slice(0, 8).map((q) => `- ${q}`),
  ];
  return lines.filter(Boolean).join("\n");
}

export function serializeDataset(samples: readonly DatasetSample[]): string {
  return samples.map((s) => JSON.stringify(s)).join("\n");
}

export function parseDataset(raw: string): DatasetSample[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as DatasetSample);
}