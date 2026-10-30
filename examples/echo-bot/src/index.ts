import { parsePersona } from "@persona/schemas";
import { createPersona } from "@persona/persona";

const persona = parsePersona({
  name: "Echo",
  styleGuide: "Reply briefly and warmly.",
  quotes: [],
});

const channel = {
  name: "echo",
  async send(chatId: string, text: string) {
    console.log(`[${chatId}] ${text}`);
  },
};

const generator = {
  async generate(system: string, turns: { role: string; content: string }[]) {
    const last = turns[turns.length - 1]?.content ?? "";
    return `You said: ${last}`;
  },
};

const bot = createPersona({ persona, channel, generator, admins: [] });
await bot.handle({ id: "1", chatId: "chat-1", text: "hello" });
