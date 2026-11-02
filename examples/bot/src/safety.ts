import type { ReplyGuard } from "@persona/persona";

/**
 * Replies the bot never sends: slurs, explicit sexual terms, and insults built on
 * "caralho". Matched on word boundaries, case-insensitive. A reply that matches is
 * skipped, so the bot stays quiet instead of sending it.
 */
const BLOCKED = [
  /\bn+[i1l]+g+[ae]+r*s?\b/iu,
  /\bnigg/iu,
  /\b(?:porn\w*|pussy|buceta|boceta|xoxota|piroca|pinto|foder|fodendo|fode|fuder|fudendo|sexo oral|punheta|gozar|nudes?)\b/iu,
  /\bcaralho\b/iu,
];

/** A character repeated six times in a row, or a word repeated four times, is a loop, not speech. */
const RUNAWAY = [
  /(?:a+h+a+h*\s*\p{Extended_Pictographic}?\s*){4,}/iu,
  /(?<ch>.)\k<ch>{5,}/u,
  /\b(?<w>\S+)(?:\s+\k<w>\b){3,}/iu,
];

export const noExplicit: ReplyGuard = (text) =>
  !BLOCKED.some((pattern) => pattern.test(text));

/** Brazilian-only forms. The persona writes European Portuguese, so such a reply is dropped. */
const BRAZILIAN = /\b(?:você|voce|vc|vcs|pra|tmb|tbm|bora|cê)\b/iu;

export const noBrazilian: ReplyGuard = (text) => !BRAZILIAN.test(text);

export const noRunaway: ReplyGuard = (text) =>
  !RUNAWAY.some((pattern) => pattern.test(text));
