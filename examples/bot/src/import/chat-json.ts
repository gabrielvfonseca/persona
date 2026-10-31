import { parseTimestamp } from "../memory/group-import";

/** One text message from a chat export, after the non-text entries are dropped. */
export interface ChatMessage {
  sender: string;
  text: string;
  /** Epoch milliseconds. */
  ts: number;
}

/** A message with the conversation window it belongs to (see `assignWindows`). */
export interface WindowedMessage extends ChatMessage {
  windowId: number;
}

/** Entries that are not conversation: placeholders, notices and deleted messages. */
const NOT_CONVERSATION =
  /omitted\s*$|^<media omitted>|end-to-end encrypted|this message was deleted|you deleted this message|^missed (?:voice|video) call/iu;

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads an ISO timestamp or a WhatsApp-style one. Returns 0 when neither parses. */
export function readChatTimestamp(raw: string): number {
  if (ISO_TIMESTAMP.test(raw)) {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : 0;
  }
  return parseTimestamp(raw);
}

/**
 * Reads a chat export of the form `{ messages: [{ sender, text, timestamp, type? }] }`,
 * the shape of the JSON exports in `trainning/`. Anything that is not a plain text
 * message is dropped: system entries, media, deleted messages and placeholders.
 * Throws when the file does not have that shape. Returns messages oldest first.
 */
export function readChatExport(raw: unknown): ChatMessage[] {
  if (!(isRecord(raw) && Array.isArray(raw.messages))) {
    throw new Error('Chat export must be an object with a "messages" array.');
  }
  const out: ChatMessage[] = [];
  for (const entry of raw.messages) {
    if (!isRecord(entry)) {
      continue;
    }
    const { sender, text, timestamp, type } = entry;
    if (typeof sender !== "string" || typeof timestamp !== "string") {
      continue;
    }
    if (type !== undefined && type !== "text") {
      continue;
    }
    const body = typeof text === "string" ? text.trim() : "";
    const ts = readChatTimestamp(timestamp);
    if (!body || ts === 0 || NOT_CONVERSATION.test(body)) {
      continue;
    }
    out.push({ sender: sender.trim(), text: body, ts });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/**
 * Splits messages into conversation windows: a gap longer than `gapMinutes`
 * starts a new window. Exchanges and graph edges never cross a window.
 */
export function assignWindows(
  messages: readonly ChatMessage[],
  gapMinutes = 30
): WindowedMessage[] {
  const gapMs = gapMinutes * 60 * 1000;
  let windowId = 0;
  return messages.map((message, i) => {
    const previous = messages[i - 1];
    if (previous && message.ts - previous.ts > gapMs) {
      windowId += 1;
    }
    return { ...message, windowId };
  });
}
