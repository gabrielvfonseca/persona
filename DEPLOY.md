# Deploying the linked-device bot (Baileys)

`examples/bot/src/node.ts` is a long-running process that keeps a WhatsApp Web session
open. Run it in the Docker container described in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), on a host with a persistent disk.

Only ever run **one** instance per WhatsApp account. Two instances sharing the same
`.auth/` directory will fight over the session.

Persistent state, relative to `examples/bot/` inside the container:

- `.auth/` holds the WhatsApp session credentials. Treat it like a password.
- `data/persona.json` is the persona file. Write it by hand from `data/persona.example.json`.

Both are mounted as volumes and never baked into the image.

## 1. Prerequisites

- Enough disk and memory for the model: about 1 GB for `qwen2.5-0.5b` plus its cache.
  The model runs in the bot's own process, so no model API key is needed.
- A WhatsApp number for the bot. A dedicated number is safer.
- A small Linux VPS (Ubuntu 24.04, 1 GB RAM is enough) with SSH access.

## 2. Install Docker on the VPS

```bash
ssh root@<VPS_IP>
curl -fsSL https://get.docker.com | sh
```

## 3. Get the code onto the VPS

Merge to `main` first, then:

```bash
git clone https://github.com/gabrielvfonseca/persona-bot.git /opt/persona
cd /opt/persona
mkdir -p examples/bot/.auth examples/bot/data
```

## 4. Build the persona (run on your laptop)

`data/` is gitignored, so write the persona locally and copy it over.

```bash
cd examples/bot
cp data/persona.example.json data/persona.json   # then edit it
scp data/persona.json root@<VPS_IP>:/opt/persona/examples/bot/data/persona.json
```

Edit the file and copy it again after each change.

## 5. Create the production env file

On the VPS, create the env file and lock it down:

```bash
touch /opt/persona/prod.env && chmod 600 /opt/persona/prod.env
```

Fill it in. The variables are listed in
[examples/bot/.env.example](examples/bot/.env.example). The linked device needs only these:

```env
PERSONA_CONSENT=true
PERSONA_NAME=<display name, as in persona.json>
PERSONA_MODEL=qwen2.5-0.5b

ADMIN_NUMBERS=<digits with country code, comma-separated, e.g. 5511999999999>
MAX_PER_10MIN=5
```

## 6. Build the image

Build from the repository root, because the workspace packages live outside `examples/bot`:

```bash
cd /opt/persona
docker build -t persona-bot -f examples/bot/Dockerfile .
```

## 7. Link the WhatsApp account (one time, interactive)

```bash
docker run -it --name persona-link \
  --env-file prod.env \
  -v /opt/persona/examples/bot/.auth:/app/examples/bot/.auth \
  -v /opt/persona/examples/bot/data:/app/examples/bot/data \
  persona-bot
```

A QR code prints in the terminal. On the phone that owns the bot number, go to
**WhatsApp → Settings → Linked Devices → Link a device**, then scan it. The QR refreshes
about every 20 seconds, so scan the newest one.

Wait for `[whatsapp] open`, then press Ctrl+C and remove the container:

```bash
docker rm persona-link
```

## 8. Find the group JID (optional)

The bot answers in groups only when someone names it or tags it, so it does not need a
group JID to run. To list the groups it is in, use the saved session:

```bash
docker run --rm -it --env-file prod.env \
  -v /opt/persona/examples/bot/.auth:/app/examples/bot/.auth \
  -v /opt/persona/examples/bot/data:/app/examples/bot/data \
  persona-bot bun scripts/groups.ts
```

## 9. Run it in the background

```bash
docker run -d --name persona --restart unless-stopped \
  --env-file /opt/persona/prod.env \
  -v /opt/persona/examples/bot/.auth:/app/examples/bot/.auth \
  -v /opt/persona/examples/bot/data:/app/examples/bot/data \
  persona-bot
```

`--restart unless-stopped` brings the bot back after crashes and VPS reboots.

## 10. Verify

```bash
docker logs -f persona
```

Look for `[whatsapp] open` and `is running (linked device)`. Then, in a direct chat with
the bot, send a message; or in a group, send `!whois`. The bot should reply.

## Database (Postgres with pgvector)

History, dedupe, rate limits, pause state, learning and memory live in Postgres. Set this
in `prod.env`:

```
DATABASE_URL=postgres://persona:<password>@<host>:5432/persona
```

Semantic recall uses the `bge-small-en-v1.5` embedding model, which runs inside the bot. It is
downloaded on first start (about 37 MB) into the `ggml_cache` volume, so the download happens
once per host. Nothing else needs to run.

The bot creates its tables on start, so the database needs the `vector` extension available
(`pgvector/pgvector:pg15`, or a managed Postgres that offers pgvector).

Either point `DATABASE_URL` at a managed database, or run the stack from
`docker/compose.yaml`, which starts Postgres next to the bot. Compose sets `DATABASE_URL` to
the `postgres` service for you:

```bash
cd /opt/persona/docker && docker compose up -d --build
docker compose logs -f persona-bot
```

With compose, the `.auth/` and `data/` volumes are the same as above, but the bot runs under
compose instead of `docker run`. Use one or the other.

## Updating

```bash
cd /opt/persona && git pull
docker build -t persona-bot -f examples/bot/Dockerfile .
docker rm -f persona
docker run -d --name persona --restart unless-stopped \
  --env-file /opt/persona/prod.env \
  -v /opt/persona/examples/bot/.auth:/app/examples/bot/.auth \
  -v /opt/persona/examples/bot/data:/app/examples/bot/data \
  persona-bot
```

The `.auth/` volume survives the update, so no re-linking is needed.

## Troubleshooting

- **`[whatsapp] logged out`** in the logs: the device was unlinked on the phone. Stop the
  container, delete the files in `/opt/persona/examples/bot/.auth/`, and repeat step 7.
- **Bot silent in a direct chat:** check that `!pause` was not sent. Only an admin can
  pause or resume, and `ADMIN_NUMBERS` must contain exact digits.
- **Bot silent in a group:** groups need the bot to be named or tagged.
- **`Cannot read persona file`:** step 4 was skipped, or the file is not in
  `examples/bot/data/persona.json` on the host.
- **`Invalid linked-device config`:** the log lists every missing or invalid variable.
- **Back up `.auth/`** somewhere encrypted. Losing it means re-linking. Leaking it lets
  someone act as the account.
