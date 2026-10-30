# persona

A toolkit for building a WhatsApp bot that learns a personality from chat exports and
replies in that voice. The SDK is split into small packages; `apps/persona` is an example
app that uses them.

## Packages

| Package | What it does |
|---|---|
| [`@persona/persona`](packages/persona) | Main SDK: `createPersona()` builds a bot from a persona, a model and a channel. |
| [`@persona/training`](packages/training) | Learns a persona from a chat export. |
| [`@persona/schemas`](packages/schemas) | The persona file format. |
| [`@persona/memory`](packages/memory) | History, memory nodes, search index, dedupe, rate limits. |
| [`@persona/policy`](packages/policy) | When to answer, and admin commands. |
| [`@persona/core`](packages/core) | Shared ports and types. |
| [`@persona/whatsapp`](packages/whatsapp) | WhatsApp transports: Cloud API (`/cloud`) and linked device via Baileys (`/baileys`). |
| [`@persona/kv`](packages/kv) | Key-value storage: history, dedupe, rate limits, pause state. |

## Quick start

```bash
bun install
bun run test

# 1. Learn a persona from an export (who has the most messages?)
bun run --cwd apps/persona ingest path/to/export.txt --list
bun run --cwd apps/persona ingest path/to/export.txt --person "Name"

# 2. Try it offline with a fake model
bun run --cwd apps/persona simulate

# 3. Run it for real (see apps/persona/.env.example)
bun run --cwd apps/persona bot
```

## Train the bot

```bash
cd apps/persona
bun run ingest export.txt --person "Name" --name "Display"      # quotes and example exchanges
bun run ingest export.txt --person "Name" --fact "Works as a nurse"   # add facts, repeatable
bun run ingest export.txt --person "Name" --facts facts.txt          # one fact per line
```

Hand-written `styleGuide`, `phrases` and `facts` survive re-runs. Set `EMBEDDING_MODEL` to
enable semantic recall, and `RECALL_LIMIT` to control how much past context each prompt gets.

## Use the SDK in your own app

```ts
import { createPersona } from "@persona/persona";
import { parsePersona } from "@persona/schemas";

const bot = createPersona({
  persona: parsePersona(personaJson),
  channel,      // { name, send(chatId, text, replyTo?) }
  generator,    // { generate(system, turns) }
  admins: ["5511999999999"],
});

await bot.handle({ id: "msg-1", chatId: "chat-1", text: "hi" });
```

`apps/persona/src/bot.ts` shows the same thing with a real model and transport.

## Docs

- [Package reference](docs/PACKAGES.md)
- [Architecture and reply pipeline](docs/ARCHITECTURE.md)
- [Deployment](docs/DEPLOYMENT.md)

## Safety defaults

- The bot only runs with `PERSONA_CONSENT=true`.
- Admin commands (`!pause`, `!resume`) need a configured admin number.
- Replies are rate limited per chat (`MAX_PER_10MIN`, default 5).
- Replies that copy a persona quote are dropped.
- Message text is never logged; only ids and reasons are.
