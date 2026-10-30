# Deploying the linked-device bot (Baileys)

`examples/persona/src/node.ts` is a long-running process that keeps a WhatsApp Web session
open. It cannot run on Cloudflare Workers, so run it in a container on a host with a
persistent disk. For the Workers deployment, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Only ever run **one** instance per WhatsApp account. Two instances sharing the same
`.auth/` directory will fight over the session.

Persistent state, relative to `examples/persona/` inside the container:

- `.auth/` holds the WhatsApp session credentials. Treat it like a password.
- `data/persona.json` is the persona file built by `bun run ingest`.

Both are mounted as volumes and never baked into the image.

## 1. Prerequisites

- An OpenRouter API key. If the key was ever committed to git, rotate it first
  (see [docs/OWNER_TODO.md](docs/OWNER_TODO.md)).
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
mkdir -p examples/persona/.auth examples/persona/data
```

## 4. Build the persona (run on your laptop)

`data/` is gitignored, so build the persona locally and copy it over.

```bash
cd examples/persona
bun run ingest path/to/export.txt --list                # find the sender's exact name
bun run ingest path/to/export.txt --person "Name" --name "Display name"
scp data/persona.json root@<VPS_IP>:/opt/persona/examples/persona/data/persona.json
```

Re-running `ingest` keeps hand-written `styleGuide`, `phrases`, `facts` and `languageHint`.
Edit those fields in `data/persona.json` and copy the file again after changing them.

## 5. Create the production env file

On the VPS, create the env file and lock it down:

```bash
touch /opt/persona/prod.env && chmod 600 /opt/persona/prod.env
```

Fill it in. The variables are listed in
[examples/persona/.env.example](examples/persona/.env.example). The linked device needs only these:

```env
PERSONA_CONSENT=true
PERSONA_NAME=<display name, as in persona.json>
PERSONA_MODEL=<OpenRouter model id>
OPENROUTER_API_KEY=<rotated key>

ADMIN_NUMBERS=<digits with country code, comma-separated, e.g. 5511999999999>
MAX_PER_10MIN=5
```

## 6. Build the image

Build from the repository root, because the workspace packages live outside `examples/persona`:

```bash
cd /opt/persona
docker build -t persona-bot -f examples/persona/Dockerfile .
```

## 7. Link the WhatsApp account (one time, interactive)

```bash
docker run -it --name persona-link \
  --env-file prod.env \
  -v /opt/persona/examples/persona/.auth:/app/examples/persona/.auth \
  -v /opt/persona/examples/persona/data:/app/examples/persona/data \
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
  -v /opt/persona/examples/persona/.auth:/app/examples/persona/.auth \
  -v /opt/persona/examples/persona/data:/app/examples/persona/data \
  persona-bot bun scripts/groups.ts
```

## 9. Run it in the background

```bash
docker run -d --name persona --restart unless-stopped \
  --env-file /opt/persona/prod.env \
  -v /opt/persona/examples/persona/.auth:/app/examples/persona/.auth \
  -v /opt/persona/examples/persona/data:/app/examples/persona/data \
  persona-bot
```

`--restart unless-stopped` brings the bot back after crashes and VPS reboots.

## 10. Verify

```bash
docker logs -f persona
```

Look for `[whatsapp] open` and `is running (linked device)`. Then, in a direct chat with
the bot, send a message; or in a group, send `!whois`. The bot should reply.

## Updating

```bash
cd /opt/persona && git pull
docker build -t persona-bot -f examples/persona/Dockerfile .
docker rm -f persona
docker run -d --name persona --restart unless-stopped \
  --env-file /opt/persona/prod.env \
  -v /opt/persona/examples/persona/.auth:/app/examples/persona/.auth \
  -v /opt/persona/examples/persona/data:/app/examples/persona/data \
  persona-bot
```

The `.auth/` volume survives the update, so no re-linking is needed.

## Troubleshooting

- **`[whatsapp] logged out`** in the logs: the device was unlinked on the phone. Stop the
  container, delete the files in `/opt/persona/examples/persona/.auth/`, and repeat step 7.
- **Bot silent in a direct chat:** check that `!pause` was not sent. Only an admin can
  pause or resume, and `ADMIN_NUMBERS` must contain exact digits.
- **Bot silent in a group:** groups need the bot to be named or tagged.
- **`Cannot read persona file`:** step 4 was skipped, or the file is not in
  `examples/persona/data/persona.json` on the host.
- **`Invalid linked-device config`:** the log lists every missing or invalid variable.
- **Back up `.auth/`** somewhere encrypted. Losing it means re-linking. Leaking it lets
  someone act as the account.
