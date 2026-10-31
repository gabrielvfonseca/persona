---
name: persona-example-bot
description: Configure, run, train and deploy examples/bot, the reference app that runs a local ggml-node model and a WhatsApp linked device inside a Docker container with Postgres (pgvector). Covers the .env schema, buildBot, the container and volumes, the TTL sweep, the ingest API, group memory ranking, and LoRA training.
modules:
  - examples/bot/src/config.ts
  - examples/bot/src/bot.ts
  - examples/bot/src/persona-file.ts
  - examples/bot/src/memory/group-index.ts
  - examples/bot/src/training/pipeline.ts
---

# persona-example-bot

`examples/bot` is the only app in the repo. It is the one place that picks a model
provider and decides who the bot answers. Everything else is a library.

It runs in a container. There is no Cloudflare runtime in the repo any more.

## Layout

| File | Role |
|---|---|
| `src/config.ts` | `configSchema` (zod), `parseConfig`, `csv`. |
| `src/bot.ts` | `buildBot`: wires config, persona, channel and policy into `createPersona`. |
| `src/model.ts`, `src/local-model.ts` | Model ids, and the local ggml-node generator. |
| `src/persona-file.ts` | `loadPersona` reads and validates `PERSONA_FILE`. |
| `src/node.ts` | The container entry point (`bun run bot`). Opens Postgres, runs the sweep, connects WhatsApp. |
| `src/learning.ts` | Learning wiring. Stores state and dataset exports in the Postgres `kv` table. |
| `src/memory/` | Postgres memory (`pg-memory.ts`) and the group memory index. |
| `src/api/app.ts` | The ingest API, served by `node.ts` when `API_PORT` is set. |
| `scripts/simulate.ts` | Offline run with a fake model and a console channel. |
| `scripts/groups.ts` | Lists WhatsApp groups for the linked device. |
| `data/persona.example.json` | Example persona. Copy it to `data/persona.json` for real use. |
| `Dockerfile`, `../../docker/compose.yaml` | The image, and the bot plus Postgres. |

## Scripts

```bash
bun run --cwd examples/bot simulate   # offline, no keys, no database
bun run --cwd examples/bot bot        # the linked device, needs .env and DATABASE_URL
bun run --cwd examples/bot groups     # list groups for the linked device
bun run --cwd examples/bot dev        # bun --watch src/node.ts
bun run --cwd examples/bot check      # biome
bun run --cwd examples/bot typecheck
bun run --cwd examples/bot test
```

Set up the environment with `bun scripts/index.ts setup` from the repo root. It copies
`.env.example` to `.env`, and runs `bun install` when `node_modules` is missing.

## Configuration

`parseConfig(env)` validates the environment and reports every problem at once.

Required: `PERSONA_CONSENT` (exactly `true`), `PERSONA_NAME` and `DATABASE_URL` (a Postgres
URL). `PERSONA_MODEL` is optional: a registry id (`qwen2.5-0.5b`, `qwen2.5-1.5b`,
`smollm2-360m`) or a `.gguf` path. Unset, it uses the active fine-tuned model in
`data/models/active.json`, else `qwen2.5-0.5b`.

Optional, with defaults: `PERSONA_FILE` (`data/persona.json`), `ADMIN_NUMBERS`,
`MAX_PER_10MIN` (5, range 1 to 100), `MODEL_CONTEXT` (4096),
`MEMORY_MAX_NODES` (50000), `API_PORT` and `API_KEY` (no API unless `API_PORT` is set),
`RECALL_LIMIT` (4, range 0 to 20), `LEARNING_*` (see below), `AUTH_DIR` (`.auth`).

Learning variables: `LEARNING_ENABLED` must be `"true"` when set. `LEARNING_WARMUP`
(5), `LEARNING_STEP` (0.5), `LEARNING_DISTILL_EVERY` (20) and `LEARNING_MAX_PATCH` (5)
tune it.

The full table is in `docs/DEPLOYMENT.md`. `.env.example` lists every key, and a contract
test keeps all three in sync.

## Container

`docker/compose.yaml` runs two services: `postgres` (pgvector) and `persona-bot`, which is
built from `examples/bot/Dockerfile` and runs `src/node.ts`. The bot waits for Postgres to be
healthy. The session credentials (`.auth`) and the persona file (`data`) are volumes, not
image contents. See [DEPLOYMENT.md](../../docs/DEPLOYMENT.md).

## Postgres

Everything that used to be a file or a Cloudflare binding lives in Postgres:

- `kv` table: chat history, dedupe keys, rate-limit windows, the pause flag, learning state
  and dataset exports. `PgKVStorage` enforces TTLs on read. `node.ts` sweeps expired rows at
  startup, every 10 minutes, and on writes (`@persona/postgres`).
- `pg_nodes` and `pg_edges`: memory nodes with `vector(384)` embeddings and graph edges.
  `PgNodeStore` refuses embeddings of any other width.

Schema changes go in `packages/postgres/migrations/`. Every statement is idempotent, and
migrations run under an advisory lock on each start.

## buildBot: the behavior switch

`buildBot` is the only place that decides how the bot behaves:

- Direct chats: always answered, since this is a linked device.
- Groups: always `addressed`.
- Admins: `csv(ADMIN_NUMBERS)`.
- Generator: passed in by the caller. `node.ts` passes the local model.
- Memory: passed in by the caller. `node.ts` passes Postgres memory wrapped with
  `createGroupMemory`, so recall also searches the group index.

## Model (`model.ts`, `local-model.ts`)

- `model.ts` is pure: registry ids and `toModelSource`.
- `local-model.ts` imports `ggml-node` and is Node-only. `createLocalModel` loads the model on
  the first reply, with `maxTokens` 60 and `temperature` 0.2.
- The tests inject a stub generator (see `tests/integration/example-bot-wiring.test.ts`).

## Group memory and the ingest API (`memory/`, `api/`)

- `group-import.ts` parses an export into records, and skips media, links and short text.
  Each record id is a hash, so re-imports are idempotent.
- `group-index.ts` ranks by keyword (required), quality, window size and recency.
- `group-store.ts` keeps group records in the Postgres `group_records` table (`pgGroupStore`). `memoryGroupStore` is the in-memory version for tests.
- `api/app.ts` serves `/v1/persona`, `/v1/memory/groups` and search, behind a bearer key.

## Training (`training/`, `scripts/train.ts`)

`bun run train` builds a chat-format dataset from the persona's example exchanges, runs LoRA
with `mlx-lm`, fuses, converts to GGUF with llama.cpp, and promotes the result only if its
validation loss beats the base and the active model. Use `--dry-run` to check the plan.

## Linked device (`node.ts`)

`bun run bot` opens Postgres, loads the persona, builds the bot once, and connects with
`connectWhatsappSocket`. The channel forwards replies to whichever socket is open, so history
and pause state survive reconnects. Pause state is read on every message, so a pause set from
another process applies. It stops cleanly on SIGINT and SIGTERM.

## Gotchas

- `buildBot` is async. Await it. Without a learning store, learning lives in memory and
  `buildBot` logs a warning.
- The persona file is written by hand. See [persona-schemas](../persona-schemas/SKILL.md).
- Only one linked-device process per WhatsApp account.
- The `api` and `groups` scripts read the same environment, so they need `DATABASE_URL` too.

## Exports

- `configSchema`
- `parseConfig`
- `csv`
- `buildBot`
- `loadPersona`

## Related

- SDK options: [persona-sdk](../persona-sdk/SKILL.md)
- Transports: [persona-whatsapp](../persona-whatsapp/SKILL.md)
- Storage: `@persona/postgres`
- Tests: `tests/unit/example-config.test.ts`, `tests/integration/example-bot-wiring.test.ts`, `examples/bot/tests/`
