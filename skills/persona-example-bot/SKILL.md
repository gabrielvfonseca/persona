---
name: persona-example-bot
description: Configure, run, test and deploy examples/bot, the reference app that wires the SDK to OpenRouter and WhatsApp in two modes, a linked device on Node and the Cloud API on Cloudflare Workers. Covers the .env schema, buildBot policy differences, Worker routes and secrets, wrangler config, and the admin basic auth.
modules:
  - examples/bot/src/config.ts
  - examples/bot/src/bot.ts
  - examples/bot/src/auth.ts
  - examples/bot/src/persona-file.ts
---

# persona-example-bot

`examples/bot` is the only app in the repo. It is the one place that picks a model
provider and decides who the bot answers. Everything else is a library.

## Layout

| File | Role |
|---|---|
| `src/config.ts` | zod schemas for env, `parseConfig`, `csv`. |
| `src/bot.ts` | `buildBot`: wires config, persona, channel and policy into `createPersona`. |
| `src/model.ts` | OpenRouter generator, describer and embedder. |
| `src/persona-file.ts` | `loadPersona` reads and validates `PERSONA_FILE`. |
| `src/node.ts` | Linked-device entry point (`bun run bot`). |
| `src/worker.ts` | Cloud API Worker: webhook, admin proxy, `/admin/persona`. |
| `src/connection.ts` | `WhatsAppConnection` Durable Object. Answers `/status` only. |
| `src/auth.ts` | `basicAuth` for the admin routes. Constant-time password compare. |
| `scripts/simulate.ts` | Offline run with a fake model and a console channel. |
| `scripts/groups.ts` | Lists WhatsApp groups for a linked device. |
| `data/persona.example.json` | Example persona. Copy it to `data/persona.json` for real use. |

## Scripts

```bash
bun run --cwd examples/bot simulate   # offline, no keys
bun run --cwd examples/bot bot        # linked device (Baileys), needs .env
bun run --cwd examples/bot groups     # list groups for the linked device
bun run --cwd examples/bot dev        # wrangler dev (Worker)
bun run --cwd examples/bot check      # biome
bun run --cwd examples/bot typecheck
bun run --cwd examples/bot test
```

Set up the environment with `bun scripts/index.ts setup` from the repo root. It
copies `.env.example` to `.env`, and runs `bun install` when `node_modules` is missing.

## Configuration

`parseConfig(env, "linked-device" | "cloud-api")` validates the environment and
reports every problem at once. The Cloud API schema has the same keys as the
linked-device schema, plus the `WHATSAPP_*` secrets and `ADMIN_KEY`.

Required in both modes: `PERSONA_CONSENT` (exactly `true`), `PERSONA_NAME`,
`PERSONA_MODEL`, `OPENROUTER_API_KEY`.

Optional, with defaults: `PERSONA_FILE` (`data/persona.json`), `ADMIN_NUMBERS`,
`MAX_PER_10MIN` (5, range 1 to 100), `STICKER_MODEL`, `EMBEDDING_MODEL`,
`RECALL_LIMIT` (4, range 0 to 20), `LEARNING_*` (see below), `AUTH_DIR` (`.auth`,
linked device only).

Learning variables: `LEARNING_ENABLED` must be `"true"` when set. `LEARNING_WARMUP`
(5), `LEARNING_STEP` (0.5), `LEARNING_DISTILL_EVERY` (20) and `LEARNING_MAX_PATCH` (5)
tune it. `buildBot` does not yet pass these to a `LearningSystem`, so setting them has no effect in the app today.

The full table is in `docs/DEPLOYMENT.md`. `.env.example` lists every key, and a
contract test keeps all three in sync.

## buildBot: the behavior switch

`buildBot` is the only place that decides how the bot behaves:

- Direct chats: `always` on the linked device, `addressed` on the Cloud API.
- Groups: always `addressed`.
- Admins: `csv(ADMIN_NUMBERS)`.
- Memory: an in-memory `createMemory` with `MAX_PER_10MIN`, unless you pass `memory`.
- Embedder: only when `EMBEDDING_MODEL` is set.
- Describer: only when `STICKER_MODEL` is set.

Pass `memory` in to swap in KV (the Worker does this).

## Model adapters (`model.ts`)

- `openRouterGenerator`: `generateText` with `maxOutputTokens: 60` and `temperature: 0.2`.
- `openRouterDescriber`: a vision model, one short description per image.
- `openRouterEmbedder`: OpenRouter's embeddings endpoint. Sorts results by `index`.

The tests replace these with fakes (see `tests/integration/example-bot-wiring.test.ts`).

## Linked device (`node.ts`)

`bun run bot` loads the persona, builds the bot once, and connects with
`connectBaileys`. The channel forwards replies to whichever socket is open, so the
history and pause state survive reconnects. It stops cleanly on SIGINT and SIGTERM.

## Cloud API Worker (`worker.ts`)

| Route | Auth | What it does |
|---|---|---|
| `GET /webhook/whatsapp` | Meta handshake | Verification challenge. |
| `POST /webhook/whatsapp` | `X-Hub-Signature-256` | Message webhook. |
| `ANY /cf-bot/*` | Basic, `ADMIN_KEY` | Proxied to the `WhatsAppConnection` Durable Object with the prefix stripped. |
| `GET /admin/persona` | Basic, `ADMIN_KEY` | Returns `{ ok, name }`. |

The Worker reads the persona from the `PERSONA_JSON` secret, so the bundle has no data file.
History, dedupe, rate limits and pause state live in the `CONVERSATIONS` KV namespace
(see [persona-kv](../persona-kv/SKILL.md)). After each message it flushes the pause state.

## Deploy the Worker

```bash
cd examples/bot
wrangler secret put OPENROUTER_API_KEY
wrangler secret put PERSONA_JSON < data/persona.json
# ...and the other secrets listed in wrangler.toml
wrangler deploy
bunx wrangler deploy --dry-run        # bundle check without deploying
```

Do not add `[vars]` to `wrangler.toml`. It would overwrite dashboard values on deploy.
Set `PERSONA_CONSENT`, `PERSONA_NAME` and `PERSONA_MODEL` as secrets.

## Gotchas

- `loadPersona` tells users to run `bun run ingest`. That command no longer exists. See [persona-schemas](../persona-schemas/SKILL.md).
- The Durable Object only answers `/status`. Linked-device sessions on Workers are not running yet (see the Durable Object note in `docs/DEPLOYMENT.md`).
- Only one linked-device process per WhatsApp account.
- The Worker's Durable Object id is hard-coded as `main-v11`. Change it in one place if you rename the namespace.
- `src/connection.ts` imports `cloudflare:workers`. Node tests must stub it (the root vitest config does).

## Exports

- `parseConfig`
- `csv`
- `linkedDeviceSchema`
- `cloudApiSchema`
- `buildBot`
- `basicAuth`
- `loadPersona`

## Related

- SDK options: [persona-sdk](../persona-sdk/SKILL.md)
- Transports: [persona-whatsapp](../persona-whatsapp/SKILL.md)
- Storage: [persona-kv](../persona-kv/SKILL.md)
- Tests: `tests/unit/example-config.test.ts`, `tests/integration/example-bot-wiring.test.ts`, `tests/integration/worker-entry.test.ts`, `examples/bot/tests/`
