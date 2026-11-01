# Deployment

The bot runs in a Docker container next to a Postgres database with pgvector. Both are
defined in [`docker/compose.yaml`](../docker/compose.yaml), and the image is built from
[`examples/bot/Dockerfile`](../examples/bot/Dockerfile). The container runs the linked device
(`examples/bot/src/node.ts`): a WhatsApp Web session through Baileys, with a local model.

Only one linked-device instance may run per WhatsApp account. For the step-by-step runbook
see [DEPLOY.md](../DEPLOY.md).

## Run it

```bash
cp examples/bot/.env.example examples/bot/.env   # fill in PERSONA_CONSENT, PERSONA_NAME, ...
docker compose -f docker/compose.yaml up -d --build
docker compose -f docker/compose.yaml logs -f persona-bot   # scan the QR code once
```

Postgres starts first and the bot waits for it to be healthy. The schema is applied on every
start (`packages/postgres/migrations/001_initial.sql`), and the advisory lock makes that safe
when several processes start at once.

## Volumes

| Path in the container | Holds | Survives |
|---|---|---|
| `/app/examples/bot/.auth` | WhatsApp session credentials | Restarts; losing it means re-linking |
| `/app/examples/bot/data` | Persona file and training output | Restarts |
| Postgres `postgres_data` | Chat history, memory, group records, learning, dataset exports | Restarts |

Session credentials and the persona file stay out of the image. Mount them as volumes.

## Environment variables

Every variable is validated by `examples/bot/src/config.ts`. A missing or invalid value stops
startup and lists every problem at once.

| Variable | Default | Description |
|---|---|---|
| `PERSONA_CONSENT` | Required | Must be exactly `true`; you have the subject's consent |
| `PERSONA_NAME` | Required | Display name; also matched when someone names the bot |
| `PERSONA_MODEL` | — | Registry id (`qwen2.5-0.5b`, `qwen2.5-1.5b`, `smollm2-360m`) or a `.gguf` path. Unset: the active fine-tuned model, else `qwen2.5-0.5b` |
| `MODEL_TEMPERATURE` | `0.2` | Sampling temperature for the local model (0–2). 0.5 to 0.8 suits a persona; low values repeat themselves |
| `MODEL_CONTEXT` | `4096` | Context window for the local model, in tokens (512–32768) |
| `MEMORY_MAX_NODES` | `50000` | Most memory nodes kept searchable; oldest are evicted |
| `API_PORT` | — | Serve the ingest API on this port. Unset: no API |
| `API_KEY` | — | Bearer token for the ingest API. Required when `API_PORT` is set; 16+ characters |
| `PERSONA_FILE` | `data/persona.json` | Persona JSON file |
| `ADMIN_NUMBERS` | — | Comma-separated phone numbers allowed to run `!pause`, `!resume` and the other admin commands |
| `MAX_PER_10MIN` | `5` | Replies per chat per 10 minutes (1–100) |
| `RECALL_LIMIT` | `4` | Past messages added to each prompt. `0` turns recall off |
| `PROMPT_EXCHANGES` | `40` | Real exchanges from the chat shown to the model as examples in each prompt |
| `DATABASE_URL` | Required | Postgres connection string (pgvector). Holds history, dedupe, rate limits, pause state, learning and memory |
| `EMBEDDING_MODEL` | `bge-small-en-v1.5` | ggml-node embedding model, run in-process. Downloaded on first use (about 37 MB) and cached. Must produce 384-dimension vectors |
| `AUTH_DIR` | `.auth` | WhatsApp session credentials. Keep on a volume, out of git |
| `LEARNING_ENABLED` | off | Set to `true` to turn on continuous learning |
| `LEARNING_WARMUP` | `5` | Outcomes and ratings before weights start to move |
| `LEARNING_STEP` | `0.5` | Step size for weight nudges |
| `LEARNING_DISTILL_EVERY` | `20` | Run distillation every N outcomes |
| `LEARNING_MAX_PATCH` | `5` | Maximum facts and phrases per patch |

## Embeddings and TTL

- **Embedding model:** memory is embedded in-process with `bge-small-en-v1.5` (384 dimensions,
  MIT). The model id is recorded in `kv`. When it changes, or when nodes exist from before it
  was recorded, the container re-embeds every node at startup and logs its progress. Measured on an Apple-silicon Mac: about 80 nodes per second, so 10,000 nodes take about 2 minutes and 50,000 about 11. The container runs on CPU and may be slower. Vectors
  from different models are not comparable, so there is no mixing.
- **Embedding width:** the column is `vector(384)`. Postgres rejects vectors of any other width,
  so an embedding model of another size needs a migration first.
- **Expiry:** rate-limit windows and dedupe keys carry a TTL. Reads ignore expired rows. The
  container also deletes them every 10 minutes, so the table does not grow without bound.

## Local checks

```bash
bun run --cwd examples/bot simulate   # offline run with a fake model
bun run --cwd examples/bot typecheck
```

`simulate` needs no Postgres. Other commands (`api`, `groups`) read the same environment, so
they need `DATABASE_URL` set.
