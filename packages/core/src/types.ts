/** One message in a chat, as the model sees it. */
export interface Turn {
  content: string;
  role: "user" | "assistant";
}

/** A transport-neutral inbound message. */
export interface IncomingMessage {
  chatId: string;
  id: string;
  isGroup?: boolean | undefined;
  media?:
    | { kind: "image" | "sticker"; data: Uint8Array; mime: string }[]
    | undefined;
  mentionsBot?: boolean | undefined;
  participantCount?: number | undefined;
  repliesToBot?: boolean | undefined;
  /** Who sent it. Defaults to `chatId` for direct chats. */
  senderId?: string | undefined;
  senderName?: string | undefined;
  text: string;
}

/** Where replies go. Implemented by a transport such as WhatsApp or Baileys. */
export interface Channel {
  name: string;
  send: (chatId: string, text: string, replyTo?: string) => Promise<void>;
}

export interface HistoryStore {
  append: (chatId: string, turns: Turn[]) => Promise<void>;
  load: (chatId: string) => Promise<Turn[]>;
}

export interface DedupeStore {
  has: (key: string) => Promise<boolean>;
  set: (key: string, ttlMs: number) => Promise<void>;
}

export interface RateLimiter {
  allow: (key: string) => Promise<boolean>;
  reset?: (key: string) => void;
}

export interface BotState {
  paused: boolean;
  setPaused: (v: boolean) => void;
}

/** Produces the reply text. Implemented by a model provider adapter. */
export interface ReplyGenerator {
  generate: (system: string, messages: Turn[]) => Promise<string>;
}

/** Turns an image into a short description the reply can use. */
export interface ImageDescriber {
  describe: (data: Uint8Array, mime: string) => Promise<string>;
}

export interface Logger {
  error: (...a: unknown[]) => void;
  info: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
}

export type HandleResult =
  | { kind: "replied" }
  | { kind: "command" }
  | { kind: "skipped"; reason: string; detail?: string }
  | { kind: "failed"; error: unknown };

/** Anything that can process an inbound message. Transports depend on this, not on the SDK. */
export interface MessageHandler {
  handle: (msg: IncomingMessage) => Promise<HandleResult>;
}

/** Turns text into vectors for similarity search. Implemented by a model provider. */
export interface Embedder {
  /** One vector per input, in input order. */
  embed: (texts: readonly string[]) => Promise<number[][]>;
}

/** Records one pipeline outcome for continuous learning. The SDK calls this after
 * every handled message; implementations are fire-and-forget and must not throw. */
/** One pipeline outcome as the learning observer receives it. */
export interface OutcomeInput {
  contextKey?: string | undefined;
  /** Persona quotes the reply is checked against for copying. */
  examples?: string[] | undefined;
  historyTurns: Turn[];
  hourBucket?: string | undefined;
  msg: IncomingMessage;
  /** Persona length stats, so the reply length can be scored. */
  personaStats?: { medianLen: number } | undefined;
  recallLines: string[];
  replyText?: string | undefined;
  result: HandleResult;
  senderId?: string | undefined;
  systemPrompt: string;
  /** True when the reply transforms changed the model's text. */
  transformed?: boolean | undefined;
}

/** Records one pipeline outcome for continuous learning. The SDK calls this after
 * every handled message; implementations are fire-and-forget and must not throw. */
export interface LearningObserver {
  recordOutcome: (input: OutcomeInput) => void;
}

/** A place for admins to rate a bot reply. Implemented by the learning engine. */
export interface FeedbackSink {
  addRating: (
    replyId: string,
    chatId: string,
    rating: number,
    comment?: string
  ) => void | Promise<void>;
}

/** Tunable weights for the system prompt, adjusted from outcomes and feedback. */
export interface PromptWeights {
  exampleBoost: number;
  extraRules: string[];
  maxWords: number;
  styleGuideStrength: number;
}

/** Tunable weights for recall fusion, adjusted from outcomes and feedback. */
export interface RecallWeights {
  keywordWeight: number;
  rrfK: number;
  semanticWeight: number;
}

export interface ContextWeights {
  prompt: PromptWeights;
  recall: RecallWeights;
}

/** The full learning state, persisted as JSON. */
export interface LearningState {
  badCount: number;
  contexts?: Record<string, ContextWeights> | undefined;
  feedbackCount: number;
  goodCount: number;
  hourBuckets?: Record<string, ContextWeights> | undefined;
  lastDistillAt?: number | undefined;
  prompt: PromptWeights;
  /** The most recent admin ratings, newest last. Capped by the engine. */
  ratings: RatingEntry[];
  recall: RecallWeights;
  schemaVersion?: number | undefined;
  senderBoost?: Record<string, number> | undefined;
  topicPhrases?: Record<string, string[]> | undefined;
  /** Weights for messages on one topic (the first topic word of the message). */
  topics?: Record<string, ContextWeights> | undefined;
}

/** One admin rating of a bot reply. */
export interface RatingEntry {
  at: number;
  chatId: string;
  comment?: string | undefined;
  rating: number;
}

/** A patch to a persona, produced by the learning engine and applied by the SDK. */
export interface PersonaPatch {
  facts?: string[] | undefined;
  phrases?: string[] | undefined;
  styleGuide?: string | undefined;
  topicPhrases?: Record<string, string[]> | undefined;
}

/** One line of the fine-tune dataset. */
export interface DatasetEntry {
  chatId: string;
  completion: string;
  historyTurns?: Turn[] | undefined;
  messages: Turn[];
  system: string;
  timestamp: number;
}
