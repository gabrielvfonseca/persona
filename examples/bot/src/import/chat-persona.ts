import type { Persona } from "@persona/schemas";
import { buildExchanges } from "../ingest/build-persona";
import type { WindowedMessage } from "./chat-json";

export interface ChatPersonaOptions {
  /** Every sender name that is this person, such as a full name and a nickname. */
  aliases: readonly string[];
  /** Lines matching any of these are never learned, such as slurs. */
  blocklist: readonly RegExp[];
  languageHint?: string | undefined;
  maxExchanges?: number | undefined;
  maxPhrases?: number | undefined;
  maxQuotes?: number | undefined;
  /** The name the persona answers to. */
  name: string;
  styleGuide: string;
}

export interface ChatCorpus {
  /** One-sided direct messages from the person. They supply quotes and phrases only. */
  direct: readonly WindowedMessage[];
  /** Group chat messages, with conversation windows. Exchanges come from here. */
  group: readonly WindowedMessage[];
}

const MAX_QUOTE_CHARS = 160;
const MAX_EXCHANGE_CHARS = 160;
const MAX_PHRASE_CHARS = 30;
const MIN_PHRASE_COUNT = 3;
const MENTION = /@\S+/gu;
const LINK = /https?:\/\//iu;
const INVISIBLE = /[‎‏‪-‮]/gu;

/** Whitespace collapsed, mentions and invisible marks removed. */
export function cleanText(text: string): string {
  return text
    .replace(INVISIBLE, "")
    .replace(MENTION, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Whether a cleaned line may be learned: not too short or long, no link, and not blocked. */
export function isLearnable(
  text: string,
  blocklist: readonly RegExp[]
): boolean {
  if (text.length < 2 || text.length > 200 || LINK.test(text)) {
    return false;
  }
  return !blocklist.some((pattern) => pattern.test(text));
}

/** Up to `count` items spread evenly across the list, so the sample covers the whole history. */
export function spreadSample<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) {
    return [...items];
  }
  const step = items.length / count;
  return Array.from(
    { length: count },
    (_, i) => items[Math.floor(i * step)] as T
  );
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
  );
}

/**
 * Builds a persona from a person's chat history. The person's messages become
 * quotes and frequent short phrases; exchanges pair what others said with what
 * they replied in the group chat. Nothing is taken from the bot's own replies.
 */
export function buildChatPersona(
  corpus: ChatCorpus,
  opts: ChatPersonaOptions
): Persona {
  const aliases = new Set(opts.aliases.map((a) => a.toLowerCase()));
  const isPerson = (sender: string) => aliases.has(sender.toLowerCase());
  const learnable = (text: string) => isLearnable(text, opts.blocklist);

  const ownTexts = [...corpus.group, ...corpus.direct]
    .filter((m) => isPerson(m.sender))
    .map((m) => cleanText(m.text))
    .filter(learnable);

  const seen = new Set<string>();
  const uniqueTexts = ownTexts.filter((t) => {
    const key = t.toLowerCase();
    if (seen.has(key) || t.length > MAX_QUOTE_CHARS || t.length < 3) {
      return false;
    }
    seen.add(key);
    return true;
  });
  const quotes = spreadSample(uniqueTexts, opts.maxQuotes ?? 200);

  const counts = new Map<string, { count: number; text: string }>();
  for (const text of ownTexts) {
    if (text.length > MAX_PHRASE_CHARS) {
      continue;
    }
    const key = text.toLowerCase();
    const entry = counts.get(key);
    counts.set(key, {
      count: (entry?.count ?? 0) + 1,
      text: entry?.text ?? text,
    });
  }
  const phrases = [...counts.values()]
    .filter((e) => e.count >= MIN_PHRASE_COUNT)
    .sort((a, b) => b.count - a.count)
    .slice(0, opts.maxPhrases ?? 30)
    .map((e) => e.text);

  // Exchanges read the group chat in order. The person's name stands in for every alias.
  const asPersona = corpus.group.map((m) => ({
    sender: isPerson(m.sender) ? opts.name : m.sender,
    text: m.text,
    windowId: m.windowId,
  }));
  const exchanges = buildExchanges(asPersona, opts.name, {
    maxChars: MAX_EXCHANGE_CHARS,
    maxExchanges: opts.maxExchanges ?? 1000,
  }).filter(
    (e) => learnable(cleanText(e.user)) && learnable(cleanText(e.assistant))
  );

  const lengths = ownTexts.map((t) => t.length);
  return {
    exchanges,
    facts: [],
    languageHint: opts.languageHint,
    name: opts.name,
    phrases,
    quotes,
    stats: {
      medianLen: median(lengths),
      messageCount: ownTexts.length,
      p90Len: percentile(lengths, 0.9),
    },
    styleGuide: opts.styleGuide,
    version: 1,
  };
}
