# examples/bot

The reference app. It runs a small language model inside the Node process (through
[ggml-node](https://www.npmjs.com/package/ggml-node)), learns a persona from a WhatsApp
export, and recalls group chat history with a ranking index.

## Setup

```bash
bun install
bun run test
```

The first reply downloads the model (`qwen2.5-0.5b`, 491 MB) into the OS cache. To fetch
it ahead of time: `bunx ggml-node pull qwen2.5-0.5b`.

## Ingest data

All ingest commands read WhatsApp `.txt` exports (iOS or Android).

```bash
# the persona: one person's messages become quotes and example exchanges
bun run ingest persona export.txt --list                       # who is in the export
bun run ingest persona export.txt --sender "Ana" --name "Ana"  # writes data/persona.json
bun run ingest persona export.txt --sender "Ana" --fact "Lives in Lisbon"

# group memory: every message of a group chat, ranked when recalled
bun run ingest group group-export.txt --group bakery-chat      # stores the records in Postgres
```

Re-running keeps hand-written persona fields (`styleGuide`, `phrases`, `facts`) and skips
group messages already stored.

### Ingest API

Serve the API without WhatsApp, or alongside the bot by setting `API_PORT`:

```bash
API_PORT=8787 API_KEY=$(openssl rand -hex 16) bun run api
curl -X POST -H "authorization: Bearer $API_KEY" --data-binary @export.txt \
  "http://localhost:8787/v1/memory/groups/bakery-chat?name=bakery"
curl -H "authorization: Bearer $API_KEY" \
  "http://localhost:8787/v1/memory/groups/bakery-chat/search?q=bakery&limit=5"
```

| Route                                     | Purpose                                          |
| ----------------------------------------- | ------------------------------------------------ |
| `POST /v1/persona?sender=…&name=…`        | Build or refresh the persona file from an export |
| `POST /v1/memory/groups/:group`           | Import a group export (duplicates skipped)       |
| `GET /v1/memory/groups`                   | List groups with counts and date range           |
| `GET /v1/memory/groups/:group/search?q=…` | Ranked matches, with each signal's score         |
| `DELETE /v1/memory/groups/:group`         | Remove a group                                   |

Every `/v1` route needs `Authorization: Bearer <API_KEY>`.

## How group memory is ranked

Each message is indexed when it is imported. At recall time, a message must match the query
by keyword, and then the score adds four signals:

| Signal  | Weight | What it measures                                                         |
| ------- | ------ | ------------------------------------------------------------------------ |
| keyword | 1.0    | BM25 match, scaled against the best match                                |
| quality | 0.3    | Text length (very short and very long score lower), a question, a number |
| window  | 0.2    | How busy the conversation was (messages in its 30-minute window)         |
| recency | 0.2    | Halves every 365 days                                                    |

The hit also returns the message before it in the same conversation, so the model sees
the question a reply answered. Keyword search is the only retrieval path: `ggml-node` does
not expose embeddings, so semantic search is not available yet.

## Calhau (Pedro Andrade): the example persona

This is the reference setup for one real person. The chat exports stay in
`trainning/` at the repository root (git-ignored). Everything derived from them goes
in `data/calhau/` (also git-ignored).

**Consent first.** The bot does not start until `PERSONA_CONSENT=true` is set in
`.env`. Set it only after Pedro has agreed to be imitated. The persona says it is an
AI bot when asked (`admitBeingABot` is on by default).

### 1. Data

| File | What it is |
|---|---|
| `trainning/chat.json` | The group chat, 125k entries. Pedro's messages are under `Pedro Andrade`. |
| `trainning/dm_01.json`, `trainning/dm_02.json` | Direct messages. Each file has one side only, so they supply quotes and phrases, not exchanges. |

Entries that are not conversation are dropped: system notices, media, deleted messages,
placeholders such as `video note omitted`, and missed calls. `Calhau[bot]` is excluded
because it is a bot account, not Pedro. Lines matching the blocklist in
`scripts/import-chat.ts` are never learned.

### 2. Persona and database

```bash
cd examples/bot
bun run import-chat -- \
  --group ../../trainning/chat.json \
  --direct ../../trainning/dm_01.json --direct ../../trainning/dm_02.json \
  --name Calhau --alias "Pedro Andrade" --alias calhau \
  --exclude "Calhau[bot]" --out data/calhau
```

This writes `data/calhau/persona.json` (quotes, phrases, about 1000 example exchanges,
and style stats). It then loads everything into Postgres:

- `group_records`: every group message, with a stable id, so re-running adds nothing.
- `pg_nodes`: every message as a node, embedded with `bge-small-en-v1.5` (384 dimensions).
  Group messages are `turn` nodes under `group:<id>`; direct messages are `quote` nodes under `dm:calhau`.
- `pg_edges`: `follows` between consecutive messages in a conversation window, and
  `answers` from a Pedro reply to the message it answered.

Use `--no-db` to write only the persona file. `DATABASE_URL` must be set otherwise.
The import takes about 20 minutes on an Apple Silicon Mac, mostly embedding.

Set `MEMORY_MAX_NODES` in `.env` to at least the number of nodes (about 111,000 here,
the default cap is 50,000). Otherwise the bot evicts the oldest history on its first reply.

### 3. Model

```bash
bun run train -- --dry-run     # builds the dataset and prints the commands
bun run train                  # LoRA on Qwen2.5-0.5B, then fuse, convert, promote if it beats the base
```

Training needs Apple Silicon, the Python packages in `.venv-train`, and `.tools/llama.cpp`
(see "Train the model" above). A promoted model is used on the next start, unless
`PERSONA_MODEL` is set.

### 4. Run

```bash
bun run --cwd examples/bot simulate   # offline check of replies
docker compose -f docker/compose.yaml up -d --build   # the WhatsApp linked device
```

Scan the QR code once from the container logs. Pedro's account, or a test account,
is the one that links.

### Supabase notes

`DATABASE_URL` points at Supabase. Supabase enables `pgvector` itself, and the
migrations create the schema on first connect. If this machine does not trust
Supabase's certificate chain, use `?uselibpqcompat=true&sslmode=require` in the URL.
That keeps the connection encrypted but does not verify the server. For verified
TLS, download Supabase's CA certificate and use `sslmode=verify-full` with it.

## Train the model

Training fine-tunes the small model on the persona's example exchanges, with LoRA, and
uses it only if it measurably beats the base model.

Requirements: Apple Silicon, plus two local tools (not part of the repo):

```bash
python3 -m venv .venv-train && .venv-train/bin/pip install mlx-lm gguf numpy sentencepiece protobuf torch
git clone --depth 1 https://github.com/ggml-org/llama.cpp.git .tools/llama.cpp
```

```bash
bun run train --dry-run     # writes the dataset and prints every command, runs nothing
bun run train               # qwen2.5-0.5b, 300 iterations
bun run train --model qwen2.5-1.5b --iters 500
```

The pipeline: write a chat-format dataset (the bot's own system prompt, plus each example
exchange) → LoRA with `mlx_lm` → fuse → convert to GGUF with llama.cpp → promote if the
validation loss beats both the base and the active model. The active model is recorded in
`data/models/active.json`, and the bot loads it on the next start, unless `PERSONA_MODEL`
is set.

Training needs at least 20 example exchanges in the persona file.

## Run

```bash
bun run bot          # WhatsApp linked device; scan the QR code once
bun run simulate     # offline conversation with a fake model
bun run groups       # list the groups this WhatsApp account is in
```

## Configuration

See [`.env.example`](.env.example) for every variable. The model is `PERSONA_MODEL`
(a registry id or a `.gguf` path); unset, it is the active fine-tuned model, else
`qwen2.5-0.5b`.

## Limits

- **Node only.** The bot runs as a linked device in a container. The local model needs a native runtime.
- **Training is Apple Silicon only** through `mlx-lm`, and needs the llama.cpp converter.
- **No semantic search.** Keyword and ranking only.
