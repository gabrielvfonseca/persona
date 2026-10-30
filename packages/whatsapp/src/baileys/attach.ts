import type { MessageHandler } from "@persona/core";
import type { WASocket } from "baileys";
import { toIncoming } from "./message";

export interface AttachBotOpts {
  includeImages?: boolean | undefined;
}

export function attachBot(
  sock: WASocket,
  bot: MessageHandler,
  opts: AttachBotOpts = {},
): void {
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      try {
        const incoming = await toIncoming(sock, msg, {
          includeImages: opts.includeImages,
        });
        if (incoming) await bot.handle(incoming);
      } catch (err) {
        console.error("Handler error:", err);
      }
    }
  });
}
