import type { Channel } from "@persona/core";

/** The socket methods a channel sends with. Any Baileys socket satisfies this. */
export interface ChannelSocket {
  sendMessage: (
    jid: string,
    content: { text: string },
    options?: { quoted?: { key: { id: string } } }
  ) => Promise<unknown>;
  sendPresenceUpdate: (
    type: "composing" | "paused",
    jid: string
  ) => Promise<unknown>;
}

const MAX_TYPING_MS = 3000;
const MS_PER_CHAR = 50;
const MIN_GAP_MS = 2000;
const GAP_JITTER_MS = 6000;

const SEND_TIMEOUT_MS = 20_000;
const PRESENCE_TIMEOUT_MS = 5000;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Rejects if the call does not settle in time, so a stalled send fails visibly instead of hanging. */
function within<T>(ms: number, label: string, call: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms} ms`)),
      ms
    );
  });
  return Promise.race([call, timeout]).finally(() => clearTimeout(timer));
}

/** Serialized WhatsApp sends with typing indicators and gaps between them. */
export class WhatsappSocketChannel implements Channel {
  private tail: Promise<void> = Promise.resolve();
  private readonly sock: ChannelSocket;
  readonly name: string;

  constructor(sock: ChannelSocket, name = "whatsapp") {
    this.sock = sock;
    this.name = name;
  }

  async send(chatId: string, text: string, replyTo?: string): Promise<void> {
    const sent = this.tail.then(() => this.deliver(chatId, text, replyTo));
    this.tail = sent
      .catch((e) => console.error("Failed to send message:", e))
      .then(() => wait(MIN_GAP_MS + Math.random() * GAP_JITTER_MS));
    await sent.catch((e) => console.error("Failed to send message:", e));
  }

  // Replies are not quoted: Baileys cannot rebuild a quote from an id alone and throws
  // (undefined quotedMsg), so the send fails. The reply id is kept for the Channel interface.
  private async deliver(
    chatId: string,
    text: string,
    _replyTo?: string
  ): Promise<void> {
    const ms = Math.min(MAX_TYPING_MS, text.length * MS_PER_CHAR);
    await within(
      PRESENCE_TIMEOUT_MS,
      "presence",
      this.sock.sendPresenceUpdate("composing", chatId)
    );
    await wait(ms);
    await within(
      PRESENCE_TIMEOUT_MS,
      "presence",
      this.sock.sendPresenceUpdate("paused", chatId)
    );
    const sent = (await within(
      SEND_TIMEOUT_MS,
      "sendMessage",
      this.sock.sendMessage(chatId, { text })
    )) as { key?: { id?: string; remoteJid?: string } } | undefined;
    // Ids only, never the text: chats are private.
    console.log(
      `[send] to=${chatId} id=${sent?.key?.id ?? "none"} remote=${sent?.key?.remoteJid ?? "none"}`
    );
  }
}
