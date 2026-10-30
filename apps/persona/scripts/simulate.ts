/**
 * Runs a short scripted conversation through the SDK with a fake model and a
 * console channel. No WhatsApp or OpenRouter account needed.
 *
 *   bun run simulate [persona.json]
 */

import { readFileSync } from "node:fs";
import type { Channel, Turn } from "@persona/core";
import { createPersona } from "@persona/persona";
import { parsePersona } from "@persona/schemas";

const personaPath = process.argv[2] ?? "data/persona.example.json";
const persona = parsePersona(JSON.parse(readFileSync(personaPath, "utf8")));

const channel: Channel = {
  name: "console",
  async send(chatId, text) {
    console.log(`  bot -> ${chatId}: ${text}`);
  },
};

// A stand-in model that echoes the last user line. No colon, so the speaker-prefix transform keeps it.
const generator = {
  async generate(_system: string, messages: Turn[]) {
    const last = messages.at(-1)?.content ?? "";
    return `Sure, ${last.slice(0, 40)}`;
  },
};

const bot = createPersona({
  persona,
  channel,
  generator,
  admins: ["5511999999999"],
  policy: { direct: "always" },
  logger: console,
});

const script: [string, string][] = [
  ["dm-1", "hi there"],
  ["dm-1", "how are you?"],
  ["dm-1", "tell me a joke"],
  ["dm-1", "what is your name?"],
  ["dm-1", "bye"],
];

console.log(`Simulating ${persona.name} (${personaPath})`);
console.log(`System prompt: ${bot.systemPrompt.split("\n")[0]}`);
for (const [chatId, text] of script) {
  console.log(`${chatId} <- ${text}`);
  const result = await bot.handle({ id: crypto.randomUUID(), chatId, text });
  console.log(`  result: ${result.kind}`);
}
