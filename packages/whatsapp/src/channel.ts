import type { Channel } from "@persona/core";
import type { WASocket } from "baileys";

const MAX_TYPING_MS = 3000;
const MS_PER_CHAR = 50;
const MIN_GAP_MS = 2000;
const GAP_JITTER_MS = 6000;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Serialized WhatsApp sends with typing indicators and gaps between them. */
export class BaileysChannel implements Channel {
  private tail: Promise<void> = Promise.resolve();
  private readonly sock: WASocket;
  readonly name: string;

  constructor(sock: WASocket, name = "baileys") {
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

  private async deliver(
    chatId: string,
    text: string,
    replyTo?: string,
  ): Promise<void> {
    const ms = Math.min(MAX_TYPING_MS, text.length * MS_PER_CHAR);
    await this.sock.sendPresenceUpdate("composing", chatId);
    await wait(ms);
    await this.sock.sendPresenceUpdate("paused", chatId);
    await this.sock.sendMessage(
      chatId,
      { text },
      replyTo ? { quoted: { key: { id: replyTo } } } : undefined,
    );
  }
}
