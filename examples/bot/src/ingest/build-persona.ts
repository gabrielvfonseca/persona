import type { Persona } from "@persona/schemas";

const PATTERN_1 = /\s+/gu;
const PATTERN_2 = /https?:\/\//u;

export interface ExportMessage {
  sender: string;
  text: string;
  /** Conversation window from `segment`. Exchanges never cross windows. */
  windowId?: number | undefined;
}

export interface BuildPersonaOptions {
  maxExchangeChars?: number | undefined;
  maxExchanges?: number | undefined;
  maxQuoteChars?: number | undefined;
  maxQuotes?: number | undefined;
  messages: readonly ExportMessage[];
  name?: string | undefined;
  sender: string;
}

export interface ExchangeOptions {
  maxChars?: number | undefined;
  maxExchanges?: number | undefined;
}

const MEDIA = "<Media omitted>";
const LINK = /https?:\/\//u;

function clean(text: string): string {
  return text.replace(PATTERN_1, " ").trim();
}

/**
 * Pairs what someone else said with the target's reply to it, in order. Only
 * short, plain-text pairs in the same window are kept. The result is spread
 * evenly across the whole export, not taken from the first N.
 */
export function buildExchanges(
  messages: readonly ExportMessage[],
  target: string,
  opts: ExchangeOptions = {}
): { user: string; assistant: string }[] {
  const maxExchanges = opts.maxExchanges ?? 40;
  const maxChars = opts.maxChars ?? 160;
  // Each reply from the target that follows another person's message in the same window.
  const pairs = messages.flatMap(
    (cur, i): { user: string; assistant: string }[] => {
      const prev = i > 0 ? messages[i - 1] : undefined;
      if (!prev || cur.sender !== target || prev.sender === target) {
        return [];
      }
      if (prev.windowId !== cur.windowId) {
        return [];
      }
      if (prev.text.includes(MEDIA) || cur.text.includes(MEDIA)) {
        return [];
      }
      if (LINK.test(prev.text) || LINK.test(cur.text)) {
        return [];
      }
      const user = clean(prev.text);
      const assistant = clean(cur.text);
      if (!(user && assistant)) {
        return [];
      }
      if (user.length > maxChars || assistant.length > maxChars) {
        return [];
      }
      return [{ assistant, user }];
    }
  );
  if (pairs.length <= maxExchanges) {
    return pairs;
  }
  const step = pairs.length / maxExchanges;
  const picked: { user: string; assistant: string }[] = [];
  for (let i = 0; i < maxExchanges; i += 1) {
    const pair = pairs[Math.floor(i * step)];
    if (pair) {
      picked.push(pair);
    }
  }
  return picked;
}

export function buildPersona(opts: BuildPersonaOptions): Persona {
  const {
    messages,
    sender,
    name = sender,
    maxQuotes = 30,
    maxQuoteChars = 80,
    maxExchanges = 40,
    maxExchangeChars = 160,
  } = opts;

  const target = messages.filter((m) => m.sender === sender).map((m) => m.text);
  if (target.length === 0) {
    throw new Error(`Unknown sender: ${sender}`);
  }

  const lens = target.map((t) => t.length).sort((a, b) => a - b);
  const median = lens[Math.floor(lens.length / 2)] || 0;
  const p90 = lens[Math.floor(lens.length * 0.9)] || 0;

  const quotes = target
    .filter((t) => t.trim() && t.length <= maxQuoteChars && !PATTERN_2.test(t))
    .sort(() => Math.random() - 0.5)
    .slice(0, maxQuotes);

  return {
    exchanges: buildExchanges(messages, sender, {
      maxChars: maxExchangeChars,
      maxExchanges,
    }),
    facts: [],
    name,
    phrases: [],
    quotes,
    stats: { medianLen: median, messageCount: target.length, p90Len: p90 },
    styleGuide: "",
    version: 1,
  };
}

export function listSenders(messages: { sender: string }[]): string[] {
  const counts = new Map<string, number>();
  for (const m of messages) {
    counts.set(m.sender, (counts.get(m.sender) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
}
