import { buildSystemPrompt } from "@persona/persona";
import type { Persona } from "@persona/schemas";

export interface ChatRow {
  messages: [
    { role: "system"; content: string },
    { role: "user"; content: string },
    { role: "assistant"; content: string },
  ];
}

export interface DatasetOptions {
  /** Refuse to train below this many exchanges. Default 20. */
  minExchanges?: number | undefined;
  /** Share of rows held out for validation. Default 0.1. */
  validFraction?: number | undefined;
}

export interface Dataset {
  systemPrompt: string;
  train: ChatRow[];
  valid: ChatRow[];
}

/**
 * Chat-format training rows from the persona's example exchanges. Each row
 * carries the same system prompt the bot uses at inference, so the model learns
 * to answer in the persona's voice under that prompt. The split is deterministic:
 * every k-th row goes to validation.
 */
export function buildDataset(
  persona: Persona,
  opts: DatasetOptions = {}
): Dataset {
  const minExchanges = opts.minExchanges ?? 20;
  const exchanges = persona.exchanges ?? [];
  if (exchanges.length < minExchanges) {
    throw new Error(
      `Need at least ${minExchanges} example exchanges to train, found ${exchanges.length}. Add more chat history to the export.`
    );
  }
  const validFraction = opts.validFraction ?? 0.1;
  if (!(validFraction > 0 && validFraction < 0.5)) {
    throw new Error("validFraction must be between 0 and 0.5.");
  }
  const systemPrompt = buildSystemPrompt(persona);
  const every = Math.max(2, Math.round(1 / validFraction));
  const train: ChatRow[] = [];
  const valid: ChatRow[] = [];
  exchanges.forEach((e, i) => {
    const row: ChatRow = {
      messages: [
        { content: systemPrompt, role: "system" },
        { content: e.user, role: "user" },
        { content: e.assistant, role: "assistant" },
      ],
    };
    (i % every === every - 1 ? valid : train).push(row);
  });
  return { systemPrompt, train, valid };
}

/** One JSON object per line, the format mlx-lm reads from a data directory. */
export function toJsonl(rows: readonly ChatRow[]): string {
  return `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
}
