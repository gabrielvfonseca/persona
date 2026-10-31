import type { MessageHandler } from "@persona/core";
import type { WASocket } from "baileys";
import { createGroupSizeLookup } from "./groups";
import { toIncoming } from "./message";

export interface AttachBotOpts {
  includeImages?: boolean | undefined;
}

export function attachBot(
  sock: WASocket,
  bot: MessageHandler,
  opts: AttachBotOpts = {}
): void {
  const groupSize = createGroupSizeLookup(sock);
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") {
      return;
    }
    for (const msg of messages) {
      try {
        // biome-ignore lint/performance/noAwaitInLoops: messages are handled in the order they arrive
        const incoming = await toIncoming(sock, msg, {
          groupSize,
          includeImages: opts.includeImages,
        });
        if (incoming) {
          await bot.handle(incoming);
        }
      } catch (err) {
        console.error("Handler error:", err);
      }
    }
  });
}
