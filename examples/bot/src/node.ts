import type { Channel } from "@persona/core";
import {
  attachBot,
  BaileysChannel,
  connectBaileys,
} from "@persona/whatsapp/baileys";
import { buildBot } from "./bot";
import { parseConfig } from "./config";
import { loadPersona } from "./persona-file";

/**
 * Runs the bot as a WhatsApp linked device on this machine.
 * Scan the QR code in the terminal once; the session lives in AUTH_DIR.
 */
async function main(): Promise<void> {
  const config = parseConfig(process.env, "linked-device");
  const persona = loadPersona(config.PERSONA_FILE);

  // The bot is built once, so its history and pause state survive reconnects.
  // Replies go to whichever socket is currently open.
  let current: BaileysChannel | null = null;
  const channel: Channel = {
    name: "baileys",
    send: (chatId, text, replyTo) => {
      if (!current) throw new Error("not connected to WhatsApp");
      return current.send(chatId, text, replyTo);
    },
  };
  const bot = buildBot({
    config,
    persona,
    channel,
    transport: "linked-device",
    logger: console,
  });

  const sock = await connectBaileys({
    authDir: config.AUTH_DIR,
    reconnect: true,
    onStatus: (status) => console.log(`[whatsapp] ${status}`),
    onSocket: (s) => {
      current = new BaileysChannel(s);
      attachBot(s, bot);
    },
  });

  const stop = () => {
    sock.end(undefined);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  console.log(`[persona] ${persona.name} is running (linked device)`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
