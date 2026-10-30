# Deployment reference

Two ways to run the bot. Both are built from `apps/persona`.

| Transport | Runs on | Entry point | Runbook |
|---|---|---|---|
| Linked device (Baileys) | A VPS or any host with a persistent disk | `apps/persona/src/node.ts` | [DEPLOY.md](../DEPLOY.md) |
| Cloud API (official webhook) | Cloudflare Workers | `apps/persona/src/worker.ts` | This page |

Only one linked-device instance may run per WhatsApp account.

## Environment variables

Every variable is validated by `apps/persona/src/config.ts`. A missing or invalid value
stops startup and lists every problem at once.

| Variable | Linked device | Cloud API | Description |
|---|---|---|---|
| `PERSONA_CONSENT` | Required | Required | Must be exactly `true` |
| `PERSONA_NAME` | Required | Required | Display name; also matched when someone names the bot |
| `PERSONA_MODEL` | Required | Required | OpenRouter model id for replies |
| `OPENROUTER_API_KEY` | Required | Required | OpenRouter key |
| `PERSONA_FILE` | Optional | Not used | Persona path (default `data/persona.json`) |
| `ADMIN_NUMBERS` | Optional | Optional | Comma-separated numbers allowed to `!pause` and `!resume` |
| `MAX_PER_10MIN` | Optional | Optional | Replies per chat per 10 minutes (default `5`) |
| `STICKER_MODEL` | Optional | Optional | Vision model used to describe images and stickers |
| `EMBEDDING_MODEL` | Optional | Optional | Embedding model for semantic recall. Unset means keyword recall only |
| `RECALL_LIMIT` | Optional | Optional | Past messages and knowledge added to each prompt (default `4`, `0` turns it off) |
| `AUTH_DIR` | Optional | Not used | WhatsApp session directory (default `.auth`) |
| `WHATSAPP_ACCESS_TOKEN` | Not used | Required | Graph API access token |
| `WHATSAPP_APP_SECRET` | Not used | Required | Used to verify webhook signatures |
| `WHATSAPP_PHONE_NUMBER_ID` | Not used | Required | Phone number id the bot sends from |
| `WHATSAPP_VERIFY_TOKEN` | Not used | Required | Token you enter in the Meta dashboard |
| `ADMIN_KEY` | Not used | Required | Basic auth password for `/cf-bot/*` and `/admin/*` |

## Cloud API on Cloudflare Workers

Deploy from `apps/persona`:

```bash
cd apps/persona
wrangler secret put OPENROUTER_API_KEY
wrangler secret put PERSONA_JSON < data/persona.json
# ...and the other secrets listed above
wrangler deploy
```

`PERSONA_JSON` holds the whole persona file, so the bundle needs no data file. The Worker
fails with a clear message if it is missing.

Configuration lives in `apps/persona/wrangler.toml`:

```toml
name = "persona-bot"
main = "src/worker.ts"
compatibility_date = "2026-10-29"
compatibility_flags = ["nodejs_compat"]

[[kv_namespaces]]
binding = "CONVERSATIONS"          # chat history and dedupe, shared across isolates
id = "<your-kv-namespace-id>"

[[durable_objects.bindings]]
name = "WHATSAPP"
class_name = "WhatsAppConnection"  # the /cf-bot/* admin proxy target
```

Routes:

- `GET` and `POST /webhook/whatsapp`: the Cloud API webhook.
- `ANY /cf-bot/*`: Basic auth with `ADMIN_KEY`, then proxied to the `WhatsAppConnection` Durable Object.
- `GET /admin/persona`: Basic auth with `ADMIN_KEY`, returns the persona name.

The Durable Object currently answers only `/status`. Linked-device sessions on Workers are
not running yet; see [OWNER_TODO.md](OWNER_TODO.md).

Do not add `[vars]` to `wrangler.toml`; it would overwrite values set in the dashboard.

## Local checks

```bash
bun run --cwd apps/persona simulate   # offline run with a fake model
bunx wrangler deploy --dry-run        # from apps/persona: bundles the Worker
```
