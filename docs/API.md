# API reference

Signatures and options for the main entry points. Every package's full export list is in
[PACKAGES.md](PACKAGES.md).

## createPersona

```ts
createPersona(opts: PersonaOptions): ConfiguredPersona
```

Builds a ready-to-use bot. Returns `{ handle, state, systemPrompt, memory }`.

| Option | Type | Default | Description |
|---|---|---|---|
| `persona` | `Persona` | required | From `parsePersona` |
| `channel` | `Channel` | required | Where replies are sent |
| `generator` | `ReplyGenerator` | required | Produces reply text |
| `describer` | `ImageDescriber` | none | Describes images and stickers |
| `logger` | `Logger` | `console` for warn and error | Receives ids and reasons only, never message text |
| `admins` | `string[]` | `[]` | Numbers or ids that may run `!pause` and `!resume` |
| `policy` | `ReplyPolicyOptions` | `{ direct: "addressed", group: "addressed" }` | When to reply; `names` defaults to `[persona.name]` |
| `prompt` | `PromptOptions` | see below | System prompt options |
| `memory` | `Memory` | `createMemory()` | Replace to persist history with KV or files |
| `recallLimit` | `number` | `0` | Past messages from the same chat added to the prompt |
| `transforms` | `ReplyTransform[]` | `[stripSpeakerPrefix, firstSentence]` | Applied to every reply |
| `guards` | `ReplyGuard[]` | `[noEcho]` | Extra checks; an empty reply is always dropped |

`handle(msg)` never throws. It returns `replied`, `command`, `skipped` (with a `reason`),
or `failed` (with an `error`).

## createPersonaBot

```ts
createPersonaBot(opts: PersonaBotOptions): PersonaBot
```

The lower-level pipeline. Use it when you want to pick every part yourself.

| Option | Required | Description |
|---|---|---|
| `channel` | yes | Where replies are sent |
| `history` | yes | A `HistoryStore` |
| `generator` | yes | A `ReplyGenerator` |
| `policy` | yes | A `ReplyPolicy` |
| `logger` | yes | A `Logger` |
| `dedupe`, `rateLimiter`, `state`, `describer` | no | Optional stores and helpers |
| `commands` | no | Result of `createCommands` |
| `systemPrompt` | no | Sent with every model call |
| `transforms`, `guards`, `examples` | no | Reply post-processing; `examples` is what `noEcho` compares against |
| `recall` | no | `(chatId, query) => string[]` extra prompt lines |

## createReplyPolicy

```ts
createReplyPolicy(opts?: ReplyPolicyOptions): ReplyPolicy
```

| Field | Type | Default | Description |
|---|---|---|---|
| `direct` | `"always" \| "addressed" \| "never"` | `"addressed"` | Direct-message trigger |
| `group` | `"always" \| "addressed" \| "never"` | `"addressed"` | Group trigger |
| `names` | `string[]` | `[]` | Names that count as being addressed |
| `allowedGroups` | `string[]` | `[]` | When non-empty, only these groups can get replies (hard deny) |
| `unpromptedProbability` | `number` | `0` | Chance of replying to an unaddressed message |
| `random` | `() => number` | `Math.random` | Random source, for tests |

## createCommands

```ts
createCommands(opts: { adminNumbers: string[]; botName: string; state: BotState })
```

Commands: `!whois` (anyone), `!pause` and `!resume` (admins). Non-admins who send an
admin command get the normal reply path, as if they had sent plain text.

## createMemory

```ts
createMemory(opts?: { maxTurns?: number; maxNodes?: number; rateWindowMs?: number; maxPerWindow?: number; embedder?: Embedder; now?: () => number }): Memory
```

- `maxTurns` (default 20) is how much history the model sees.
- `maxNodes` (default 10,000) caps how many nodes stay searchable.
- `embedder` turns on semantic recall. Turns are embedded as they are appended.
- `remember(chatId, text, kind?)` adds a node. `learn(text)` adds knowledge that every chat can recall.
- `recall(chatId, query, limit?)` is async. It returns the best nodes from that chat and the
  shared knowledge, ranked by keyword and embedding together (reciprocal rank fusion).

## parsePersona

```ts
parsePersona(raw: unknown): Persona
```

Validates a persona file. Also accepts the legacy `{ profile: {...} }` shape.

```ts
{
  version: 1;
  name: string;
  styleGuide: string;
  languageHint?: string;
  stats: { medianLen: number; p90Len: number; messageCount?: number };
  quotes: string[];
  phrases: string[];
  facts: string[];
}
```

## buildSystemPrompt

```ts
buildSystemPrompt(persona: Persona, opts?: PromptOptions): string
```

| Field | Default | Description |
|---|---|---|
| `maxWords` | `15` | Reply length the prompt asks for |
| `maxExamples` | `8` | Quotes included as examples |
| `maxExampleChars` | `80` | Longer quotes are skipped |
| `admitBeingABot` | `true` | Tell the model to admit being an AI when asked |
| `extraRules` | `[]` | Extra lines added to the prompt |
| `platform` | none | Accepted, not used yet |

## trainFromExport

```ts
trainFromExport(raw: string, opts: { sender: string; name?: string; maxQuotes?: number; maxQuoteChars?: number }): Persona
```

Parses a WhatsApp export and builds a persona for one sender. Throws `Unknown sender` if the
name does not appear in the export.

## CloudApiClient

```ts
new CloudApiClient({ phoneNumberId: string; accessToken: string; graphVersion?: string; fetch?: typeof fetch })
```

Implements `Channel`. Methods: `send(chatId, text, replyTo?)`, `markRead(chatId)`,
`downloadMedia(id, maxBytes)`.

## createCloudApiWebhook

```ts
createCloudApiWebhook(opts: { bot: MessageHandler; appSecret: string; verifyToken: string; phoneNumberId: string; downloadMedia?: (id: string, maxBytes: number) => Promise<Uint8Array> }): (req: Request, ctx?: ExecutionContextLike) => Promise<Response>
```

`GET` answers the verify handshake. `POST` checks the signature (403 on failure), then
passes messages to `bot.handle`.

## basicAuth

```ts
basicAuth(req: Request, password: string): Response | null
```

Returns `null` when the request is authorized, or a 401 `Response` when it is not. An empty
password always denies. A malformed header returns 401, never 500.
