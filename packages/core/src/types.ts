/** One message in a chat, as the model sees it. */
export interface Turn {
  role: "user" | "assistant";
  content: string;
}

/** A transport-neutral inbound message. */
export interface IncomingMessage {
  id: string;
  chatId: string;
  /** Who sent it. Defaults to `chatId` for direct chats. */
  senderId?: string | undefined;
  text: string;
  senderName?: string | undefined;
  isGroup?: boolean | undefined;
  mentionsBot?: boolean | undefined;
  repliesToBot?: boolean | undefined;
  media?:
    | { kind: "image" | "sticker"; data: Uint8Array; mime: string }[]
    | undefined;
}

/** Where replies go. Implemented by a transport such as WhatsApp or Baileys. */
export interface Channel {
  name: string;
  send(chatId: string, text: string, replyTo?: string): Promise<void>;
}

export interface HistoryStore {
  load(chatId: string): Promise<Turn[]>;
  append(chatId: string, turns: Turn[]): Promise<void>;
}

export interface DedupeStore {
  has(key: string): Promise<boolean>;
  set(key: string, ttlMs: number): Promise<void>;
}

export interface RateLimiter {
  allow(key: string): Promise<boolean>;
  reset?(key: string): void;
}

export interface BotState {
  paused: boolean;
  setPaused(v: boolean): void;
}

/** Produces the reply text. Implemented by a model provider adapter. */
export interface ReplyGenerator {
  generate(system: string, messages: Turn[]): Promise<string>;
}

/** Turns an image into a short description the reply can use. */
export interface ImageDescriber {
  describe(data: Uint8Array, mime: string): Promise<string>;
}

export interface Logger {
  info(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
}

export type HandleResult =
  | { kind: "replied" }
  | { kind: "command" }
  | { kind: "skipped"; reason: string; detail?: string }
  | { kind: "failed"; error: unknown };

/** Anything that can process an inbound message. Transports depend on this, not on the SDK. */
export interface MessageHandler {
  handle(msg: IncomingMessage): Promise<HandleResult>;
}

/** Turns text into vectors for similarity search. Implemented by a model provider. */
export interface Embedder {
  /** One vector per input, in input order. */
  embed(texts: readonly string[]): Promise<number[][]>;
}

/** Records one pipeline outcome for continuous learning. The SDK calls this after
 * every handled message; implementations are fire-and-forget and must not throw. */
export interface LearningObserver {
  recordOutcome(input: {
    msg: IncomingMessage;
    result: HandleResult;
    systemPrompt: string;
    historyTurns: Turn[];
    recallLines: string[];
    replyText?: string | undefined;
  }): void;
}

/** A place for admins to rate a bot reply. Implemented by the learning engine. */
export interface FeedbackSink {
  addRating(
    replyId: string,
    chatId: string,
    rating: number,
    comment?: string,
  ): void | Promise<void>;
}

/** Tunable weights for the system prompt, adjusted from outcomes and feedback. */
export interface PromptWeights {
  maxWords: number;
  exampleBoost: number;
  styleGuideStrength: number;
  extraRules: string[];
}

/** Tunable weights for recall fusion, adjusted from outcomes and feedback. */
export interface RecallWeights {
  keywordWeight: number;
  semanticWeight: number;
  rrfK: number;
}

/** The full learning state, persisted as JSON. */
export interface LearningState {
  prompt: PromptWeights;
  recall: RecallWeights;
  feedbackCount: number;
  goodCount: number;
  badCount: number;
  lastDistillAt?: number | undefined;
}

/** A patch to a persona, produced by the learning engine and applied by the SDK. */
export interface PersonaPatch {
  facts?: string[] | undefined;
  phrases?: string[] | undefined;
  styleGuide?: string | undefined;
}

/** One line of the fine-tune dataset. */
export interface DatasetEntry {
  messages: Turn[];
  system: string;
  completion: string;
  chatId: string;
  timestamp: number;
  historyTurns?: Turn[] | undefined;
}
