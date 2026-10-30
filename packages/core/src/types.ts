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
