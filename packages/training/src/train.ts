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
