# Package Reference

The SDK is split into bounded contexts. Each package owns one part of the bot and
depends only on the packages below it in this table.

| Package | Context | Depends on |
|---|---|---|
| `@persona/core` | Shared ports and types (`Channel`, `HistoryStore`, `ReplyGenerator`, …). No runtime code. | nothing |
| `@persona/schemas` | The persona file format and its parser. | zod |
| `@persona/policy` | Who the bot answers and which admin commands run. | core |
| `@persona/memory` | Chat history, memory nodes, search index, dedupe, rate limits. | core |
| `@persona/learning` | Continuous learning: outcomes, feedback, weight tuning, persona patches, fine-tune dataset. | core, schemas |
| `@persona/persona` | **Main SDK.** Builds a bot from a persona, a model and a channel. | core, schemas, policy, memory |
| `@persona/whatsapp` | WhatsApp for bots: Cloud API webhook and linked device (Baileys), one API. | core, zod, @openchannelprotocol/sdk, baileys |
| `@persona/postgres` | Postgres (pgvector) storage: key-value state (history, dedupe, rate limits, pause), memory nodes with keyword, semantic and graph search. | core |

Example app: `examples/bot`. It is the only place that picks a model provider.

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
| `admins` | `[]` | Phone numbers or ids for `!pause`, `!resume`, `!good`, `!bad`, `!weights`, `!dataset`, `!learn`, `!distill`. |
| `memory` | `createMemory()` | Pass your own to use KV, files or a different limit. |
| `recallLimit` | `0` | Past messages from the same chat added to each prompt. `0` is off. |
| `transforms` | speaker prefix, first sentence | Replaces the defaults. |
| `guards` | `noEcho` | Added to the built-in empty-reply check. |
| `prompt` | see `PromptOptions` | `maxWords`, `extraRules`, `admitBeingABot`, and more. |
| `learning` | none | A `LearningObserver` that records outcomes for continuous learning. |
| `weights` | defaults | Tunable prompt weights, adjusted by the learning engine. |
| `onPatch` | none | Called with a persona patch after distillation. |
| `setPromptWeights` | none | Update the prompt weights at runtime. |
| `setRecallWeights` | none | Update the recall fusion weights at runtime. |

## @persona/learning

| Export | Purpose |
|---|---|
| `LearningEngine` | Tunable weights, distillation, dataset collection. |
| `LearningSystem` | Wires the engine to the pipeline. `recordOutcome` is the `LearningObserver`; `addRating` is the `FeedbackSink`. |
| `noopLearningObserver`, `noopFeedbackSink` | No-op implementations for when learning is off. |
| `defaultLearningState`, `applyPatch` | Defaults and patch helpers. |

The engine tunes `PromptWeights` (maxWords, exampleBoost, styleGuideStrength, extraRules) and `RecallWeights` (keywordWeight, semanticWeight, rrfK). Distillation runs every N outcomes and produces a `PersonaPatch` of facts, phrases and style-guide lines.

## @persona/memory

| Export | Purpose |
|---|---|
| `createMemory(opts?)` | Returns `{ nodes, history, dedupe, rateLimiter, state, remember, learn, recall, setRecallWeights }`. `recall` is async. Pass an `embedder` for semantic recall. |
| `fuseWeighted`, `weightedReciprocalRankFusion` | Weighted fusion of ranked node lists. |
| `NodeStore` | Stores nodes per chat, indexed by keyword (BM25) and by embedding (cosine). `add`, `get`, `recent`, `search`, `nearest`. |
| `learn(text)` | Adds shared knowledge that every chat can recall. |
| `reciprocalRankFusion`, `cosine`, `embedOrUndefined` | Ranking helpers. A failed embedding falls back to keyword search. |
| `SearchIndex`, `tokenize` | BM25 index over text. Unicode-aware. |
| `MemoryHistoryStore` | A `HistoryStore`. Returns the last `maxTurns` (default 20); older turns stay searchable. |
| `MemoryDedupeStore`, `FixedWindowRateLimiter`, `MemoryBotState` | In-memory stores. The limiter keeps one window per key. |

Memory is in-process. The example app persists it in Postgres (`@persona/postgres`) by passing its own `HistoryStore`.

## @persona/policy

| Export | Purpose |
|---|---|
| `createReplyPolicy(opts)` | Decides `always` or `never` per message. Names are matched on word boundaries. |
| `mentionsName(text, name)` | The name matcher on its own. |
| `createCommands(opts)` | `!whois` (anyone), `!pause`, `!resume`, `!good`, `!bad`, `!weights`, `!dataset`, `!learn`, `!distill` (admins). Pass `onRate`, `onWeights`, `onDataset`, `onDistill`, `onLearn` (or `commands` on `createPersona`) to wire learning and `!learn`. |


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

One package, one entry point (`import ... from "@persona/whatsapp"`). Both transports
produce the same `IncomingMessage` and implement `Channel`.

| Export | Transport | Purpose |
|---|---|---|
| `createWhatsappWebhook(opts)` | Cloud API | Webhook handler. `GET` for the verify handshake, `POST` for messages. Takes an optional background context (a Workers `ExecutionContext` fits) as its second argument. |
| `WhatsappClient` | Cloud API | Sends messages and downloads media through the Graph API. Implements `Channel`. |
| `WhatsappError` | Cloud API | Error thrown on a failed Graph API call. |
| `connectWhatsappSocket(opts)` | Linked device | Opens a Baileys socket. Prints a QR code on first login. |
| `WhatsappSocketChannel` | Linked device | Serialized sends with typing indicators. Implements `Channel`. |
| `attachBot(sock, bot, opts)` | Linked device | Routes incoming messages to a `MessageHandler`. |
| `toIncoming(sock, msg, opts)` | Linked device | Async. Turns a Baileys message into an `IncomingMessage`, downloading images and stickers. |
| `runOnNode(bot, opts)`, `withSocket(fn, opts)` | Linked device | Run a long-lived bot, or a short script with a socket. |
| `listGroups(sock)` | Linked device | Lists the groups the linked device is in. |
| `useKeyValueAuthState(storage, prefix)` | Linked device | Keeps Baileys auth in any key-value store. |

Linked-device code runs on Node, inside the container.

## @persona/postgres

`kvHistoryStore`, `kvDedupeStore`, `loadKvBotState` (pause state) and `kvRateLimiter` work on any `KVStorage`. `PgKVStorage` implements `KVStorage` on the `kv` table (TTLs enforced on read, expired rows swept).
`PgNodeStore` keeps memory nodes in `pg_nodes`: full-text keyword search, pgvector cosine search, and
graph edges in `pg_edges` walked with a recursive CTE (`traverse`). `migrate(pool)` applies the schema
(`migrations/001_initial.sql`) and is safe to run on every start. The example app builds its Postgres
memory in `examples/bot/src/memory/pg-memory.ts`.
