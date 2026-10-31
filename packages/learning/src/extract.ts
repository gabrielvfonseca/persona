import type { HandleResult, IncomingMessage, Turn } from "@persona/core";

const PATTERN_1 = /!/gu;
const PATTERN_2 = /[\u{1F300}-\u{1FAFF}]/u;
const PATTERN_3 = /[a-z]/u;
const PATTERN_4 = /[.!?]$/u;
const PATTERN_5 = /[A-Z]/u;

/** A single signal the learning engine can act on. */
export interface Outcome {
  contextKey?: string | undefined;
  extractedFact?: string | undefined;
  historyTurns: Turn[];
  hourBucket?: string | undefined;
  lengthRatio?: number | undefined;
  msg: IncomingMessage;
  recallLines: string[];
  repeatScore?: number | undefined;
  replyText?: string | undefined;
  result: HandleResult;
  senderId?: string | undefined;
  systemPrompt: string;
  timestamp: number;
  tone?: "casual" | "formal" | "neutral" | undefined;
  topicTags?: string[] | undefined;
  transformed?: boolean | undefined;
}

/**
 * Turns a pipeline outcome into a learning signal in [-1, 1]. A clean reply is +1
 * and quality terms subtract from it. A skip is judged by its reason, and a failure is -1.
 */
export function outcomeSignal(outcome: Outcome): number {
  switch (outcome.result.kind) {
    case "replied": {
      let quality = 1;
      if (isFiniteNumber(outcome.lengthRatio) && outcome.lengthRatio > 0) {
        // Within 2x of the persona's median length is fine. Beyond that, quality
        // falls with each doubling and goes negative for extreme lengths.
        const doublings = Math.abs(Math.log2(outcome.lengthRatio));
        quality -= 0.5 * Math.max(0, doublings - 1);
      }
      if (outcome.transformed) {
        quality -= 0.3;
      }
      if (isFiniteNumber(outcome.repeatScore)) {
        quality -= 0.3 * Math.min(1, Math.max(0, outcome.repeatScore));
      }
      return clamp(quality, -1, 1);
    }
    case "failed":
      return -1;
    case "skipped": {
      const { reason } = outcome.result;
      if (reason === "not-addressed") {
        // Staying quiet in a group is right; ignoring a direct message is wrong.
        return outcome.msg.isGroup ? 0.3 : -0.5;
      }
      if (reason === "empty") {
        return -0.5;
      }
      if (reason === "guard") {
        return -0.3;
      }
      return 0;
    }
    case "command":
      return 0;
    default:
      return 0;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** True when the reply was actually generated and sent. */
export function wasReplied(outcome: Outcome): boolean {
  return outcome.result.kind === "replied";
}

/** True when generation or sending failed. */
export function wasFailed(outcome: Outcome): boolean {
  return outcome.result.kind === "failed";
}

export function computeTone(text: string): "casual" | "formal" | "neutral" {
  const lower = text.toLowerCase();
  const exclam = (text.match(PATTERN_1) ?? []).length;
  const emoji = PATTERN_2.test(text);
  const hasLower = PATTERN_3.test(text) && text === lower;
  if ((exclam >= 1 || emoji) && hasLower) {
    return "casual";
  }
  if (PATTERN_4.test(text.trim()) && PATTERN_5.test(text)) {
    return "formal";
  }
  return "neutral";
}

const WHEN_ASKED =
  /\b(?<g1>when|what time|time is|what day|what date|which day|quando|que horas|qual dia)\b/u;
const WHERE_ASKED = /\b(?<g1>where|onde)\b/u;
const TIME_OR_DATE =
  /\b(?<g1>\d{1,2}:?\d{0,2}\s?(?<g2>am|pm)?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})\b/iu;
const PLACE_NOUN =
  /\b(?<g1>street|st\.|avenue|ave\.|road|rd\.|building|room|floor|suite|park|mall|cafe|café|office|house|apt|plaza|square|rua|avenida|praça|bairro|andar|sala|shopping|bar|restaurante|cinema|escola|aeroporto)\b/iu;
/** A preposition followed by a capitalised name, such as "at Rua Augusta" or "no Shopping". */
const PLACE_PREPOSITION = /\b(?:in|at|near|on|em|no|na) [A-Z0-9]/u;

/** A reply to a when/where question becomes a fact the persona can keep. */
export function extractFact(text: string, reply: string): string | undefined {
  const t = text.toLowerCase();
  if (WHEN_ASKED.test(t) && TIME_OR_DATE.test(reply)) {
    return reply.trim().slice(0, 80);
  }
  if (
    WHERE_ASKED.test(t) &&
    (PLACE_NOUN.test(reply) || PLACE_PREPOSITION.test(reply))
  ) {
    return reply.trim().slice(0, 80);
  }
  return undefined;
}

/** How closely a reply copies one persona quote, from 0 (none) to 0.9 (identical). */
function quoteOverlap(reply: string, quote: string): number {
  if (quote.length < 5) {
    return 0;
  }
  if (quote.length >= 20 && reply.includes(quote)) {
    return 0.8;
  }
  if (reply === quote) {
    return 0.9;
  }
  return reply.includes(quote.slice(0, 20)) ? 0.4 : 0;
}

/** The strongest overlap between a reply and any persona quote. */
export function computeRepeatScore(
  reply: string,
  examples: readonly string[]
): number {
  const r = reply.trim().toLowerCase();
  if (!r) {
    return 0;
  }
  return examples.reduce(
    (score, e) => Math.max(score, quoteOverlap(r, e.trim().toLowerCase())),
    0
  );
}

/** The message text as the model sees it, prefixed with the sender in groups. */
export function userContent(msg: IncomingMessage): string {
  return msg.isGroup && msg.senderName
    ? `${msg.senderName}: ${msg.text}`
    : msg.text;
}
