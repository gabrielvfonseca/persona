# persona

A toolkit for building a WhatsApp bot that learns a personality from chat exports and
replies in that voice. The SDK is split into small packages; `examples/bot` is an example
app that uses them.

## Packages

| Package | What it does |
|---|---|
| [`@persona/persona`](packages/persona) | Main SDK: `createPersona()` builds a bot from a persona, a model and a channel. |
| [`@persona/learning`](packages/learning) | Continuous learning: outcomes, feedback, weight tuning, persona patches, fine-tune dataset. |
| [`@persona/schemas`](packages/schemas) | The persona file format. |
| [`@persona/memory`](packages/memory) | History, memory nodes, search index, dedupe, rate limits. |
| [`@persona/policy`](packages/policy) | When to answer, and admin commands. |
| [`@persona/core`](packages/core) | Shared ports and types. |
| [`@persona/whatsapp`](packages/whatsapp) | WhatsApp for bots: Cloud API webhook and linked device (Baileys), one API. |
| [`@persona/postgres`](packages/postgres) | Postgres (pgvector) storage: key-value state (history, dedupe, rate limits, pause), memory nodes, graph edges. |

## Continuous learning

Set `LEARNING_ENABLED=true` to turn on. The bot records every outcome (replied,
failed, skipped) and uses it to tune prompt and recall weights. Admins can rate
replies and run distillation:

```
!good          # mark last reply as good
!bad too vague # mark last reply as bad, with a comment
!weights      # show current learning weights
!dataset      # export the fine-tune dataset
!learn <fact> # add a fact to the persona
!distill      # run distillation now
```

The learning state persists in the Postgres `kv` table, or in
`.auth/learning.json` on the linked device. Distillation produces a persona
patch (facts, phrases, style-guide) that is applied immediately.

## Quick start

```bash
bun install
bun run test

# 1. Create the persona file by hand, starting from the example
cp examples/bot/data/persona.example.json examples/bot/data/persona.json

# 2. Try it offline with a fake model
bun run --cwd examples/bot simulate

# 3. Run it for real (see examples/bot/.env.example)
bun run --cwd examples/bot bot
```

## The persona file

The bot reads `examples/bot/data/persona.json` (or `PERSONA_FILE`). There is no import
tool. Copy `data/persona.example.json` and edit it: `name`, `styleGuide`, `quotes`,
`phrases`, `facts` and optional `exchanges` (real `{ user, assistant }` pairs). Only use
messages from someone who has consented. The format is in `skills/persona-schemas`.

Train the model with `bun run train` (see [examples/bot](examples/bot/README.md)). `RECALL_LIMIT` controls how much past context each prompt gets.

When `LEARNING_ENABLED=true`, the bot adjusts its prompt from outcomes and admin ratings,
and saves that state in Postgres. `!dataset` writes the entries to Postgres as well.

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

`examples/bot/src/bot.ts` shows the same thing with a real model and transport.

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
