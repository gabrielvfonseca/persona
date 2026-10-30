# Package Reference

The SDK is split into bounded contexts. Each package owns one part of the bot and
depends only on the packages below it in this table.

| Package | Context | Depends on |
|---|---|---|
| `@persona/core` | Shared ports and types (`Channel`, `HistoryStore`, `ReplyGenerator`, …). No runtime code. | nothing |
| `@persona/schemas` | The persona file format and its parser. | zod |
| `@persona/policy` | Who the bot answers and which admin commands run. | core |
| `@persona/memory` | Chat history, memory nodes, search index, dedupe, rate limits. | core |
| `@persona/persona` | **Main SDK.** Builds a bot from a persona, a model and a channel. | core, schemas, policy, memory |
| `@persona/training` | Learns a persona from a chat export. | schemas |
| `@persona/whatsapp` | WhatsApp transports: Cloud API (`/cloud`) and linked device (`/baileys`). | core, zod, @openchannelprotocol/sdk, baileys |
| `@persona/kv` | Key-value storage: history, dedupe, rate limits, pause state. | core |

Example app: `examples/persona`. It is the only place that picks a model provider.

## @persona/persona (the SDK)

```ts
import { createPersona } from "@persona/persona";
import { parsePersona } from "@persona/schemas";

const bot = createPersona({
  persona: parsePersona(json),   // from data/persona.json
  channel,                       // any Channel
  generator,                     // any ReplyGenerator
  admins: ["5511999999999"],     // may run !pause / !resume
  policy: { direct: "always", group: "addressed" },
});

await bot.handle({ id, chatId, text, senderName, isGroup, mentionsBot });
```

| Export | Purpose |
|---|---|
| `createPersona(opts)` | One call that wires memory, policy, commands, prompt and guards. Returns `{ handle, state, systemPrompt, memory }`. |
| `createPersonaBot(opts)` | The lower-level pipeline. You pick every part. |
| `buildSystemPrompt(persona, opts?)` | The system prompt for a persona. |
| `stripSpeakerPrefix`, `firstSentence` | Reply transforms. |
| `noEcho`, `notEmpty` | Reply guards. `noEcho` drops replies that copy a persona quote. |
| `Persona`, `PersonaBot`, `ConfiguredPersona` | Types. |

Options for `createPersona`:

| Option | Default | Notes |
|---|---|---|
| `policy.direct` | `"addressed"` | `"always"` answers every direct chat. |
| `policy.group` | `"addressed"` | Groups answer only when named or tagged. |
| `admins` | `[]` | Phone numbers or ids for `!pause` and `!resume`. |
| `memory` | `createMemory()` | Pass your own to use KV, files or a different limit. |
| `recallLimit` | `0` | Past messages from the same chat added to each prompt. `0` is off. |
| `transforms` | speaker prefix, first sentence | Replaces the defaults. |
| `guards` | `noEcho` | Added to the built-in empty-reply check. |
| `prompt` | see `PromptOptions` | `maxWords`, `extraRules`, `admitBeingABot`, and more. |

## @persona/memory

| Export | Purpose |
|---|---|
| `createMemory(opts?)` | Returns `{ nodes, history, dedupe, rateLimiter, state, remember, learn, recall }`. `recall` is async. Pass an `embedder` for semantic recall. |
| `NodeStore` | Stores nodes per chat, indexed by keyword (BM25) and by embedding (cosine). `add`, `get`, `recent`, `search`, `nearest`. |
| `learn(text)` | Adds shared knowledge that every chat can recall. |
| `reciprocalRankFusion`, `cosine`, `embedOrUndefined` | Ranking helpers. A failed embedding falls back to keyword search. |
| `SearchIndex`, `tokenize` | BM25 index over text. Unicode-aware. |
| `MemoryHistoryStore` | A `HistoryStore`. Returns the last `maxTurns` (default 20); older turns stay searchable. |
| `MemoryDedupeStore`, `FixedWindowRateLimiter`, `MemoryBotState` | In-memory stores. The limiter keeps one window per key. |

Memory is in-process. Persist it by passing your own `HistoryStore` (see `examples/persona/src/worker.ts`, which uses KV).

## @persona/policy

| Export | Purpose |
|---|---|
| `createReplyPolicy(opts)` | Decides `always` or `never` per message. Names are matched on word boundaries. |
| `mentionsName(text, name)` | The name matcher on its own. |
| `createCommands(opts)` | `!whois` (anyone), `!pause` and `!resume` (admins). |

## @persona/training

| Export | Purpose |
|---|---|
| `trainFromExport(raw, { sender, name? })` | Export text → `Persona` with quotes and example `exchanges`. Hand-written fields start empty. |
| `buildExchanges(messages, target)` | Pairs what others said with the target's replies, within one conversation window. |
| `listSenders(messages)` | Senders ordered by message count. |
| `parseExport(raw)`, `segment(messages)` | iOS and Android exports, with 30-minute conversation windows. |
| `parseExportDate(ts, "dmy" \| "mdy")` | Explicit date parsing. Export dates are never passed to `new Date()`. |

## @persona/schemas

| Export | Purpose |
|---|---|
| `personaV1` | The zod schema. |
| `parsePersona(raw)` | Validates a persona. Also accepts the legacy `{ profile: {...} }` shape. |
| `Persona` | The type. |

## @persona/core

Types only: `IncomingMessage`, `Channel`, `HistoryStore`, `DedupeStore`, `RateLimiter`,
`BotState`, `ReplyGenerator`, `ImageDescriber`, `Logger`, `MessageHandler`, `Turn`, `HandleResult`.

## @persona/whatsapp

Two entry points, so each bundle includes only what it uses.

### `@persona/whatsapp/cloud` (Workers)

| Export | Purpose |
|---|---|
| `createCloudApiWebhook(opts)` | Webhook handler. `GET` for the verify handshake, `POST` for messages. Accepts the Workers `ExecutionContext` as its second argument. |
| `CloudApiClient` | Sends messages and downloads media through the Graph API. Implements `Channel`. |
| `ExecutionContextLike` | The `waitUntil` shape the webhook needs. |

### `@persona/whatsapp/baileys` (Node)

`BaileysChannel`, `connectBaileys`, `attachBot`, `listGroups`, `useKeyValueAuthState`,
`toIncoming` (async: downloads images and stickers). `runOnNode` and `withSocket` live at
`@persona/whatsapp/baileys/node`. `ws-shim` at `@persona/whatsapp/baileys/ws-shim` is the
Workers WebSocket shim.

## @persona/kv

`kvHistoryStore`, `kvDedupeStore`, `loadKvBotState` (pause state), `kvRateLimiter`.
`basicAuth` lives in `examples/persona`, not in a package.
