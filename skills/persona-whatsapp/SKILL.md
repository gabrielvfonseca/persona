---
name: persona-whatsapp
description: Connect the persona bot to WhatsApp through the single @persona/whatsapp package, using the Cloud API webhook or a linked device over Baileys (Node). Covers the webhook handshake and signatures, media limits, send pacing, QR login, auth storage, group lookup, the Workers ws alias, and known reconnect problems.
modules:
  - packages/whatsapp/src/index.ts
---

# persona-whatsapp

`@persona/whatsapp` is one package with one entry point, `import ... from "@persona/whatsapp"`.
It has two transports that share a message shape. Both implement `Channel` from `@persona/core`.

| Transport | Runs on | Account | Entry points |
|---|---|---|---|
| Cloud API | Any HTTP host | Official Meta WhatsApp Business app | `createWhatsappWebhook`, `WhatsappClient` |
| Linked device | Node, with a persistent disk | Your WhatsApp account, via QR | `connectWhatsappSocket`, `attachBot`, `WhatsappSocketChannel`, `runOnNode` |

Only one linked-device instance may run per WhatsApp account.

## Cloud API

```ts
import { WhatsappClient, createWhatsappWebhook } from "@persona/whatsapp";

const client = new WhatsappClient({ phoneNumberId, accessToken }); // implements Channel
const webhook = createWhatsappWebhook({
  bot,                                   // any MessageHandler, e.g. createPersona(...)
  appSecret,                             // verifies X-Hub-Signature-256
  verifyToken,                           // matched against hub.verify_token
  phoneNumberId,                         // only messages to this number are handled
  downloadMedia: (id, maxBytes) => client.downloadMedia(id, maxBytes),
});

// Hono: app.post("/webhook/whatsapp", (c) => webhook(c.req.raw));
```

Behavior:

- `GET` answers the Meta handshake. It returns the challenge when the token matches, otherwise `403`.
- `POST` checks the signature over the raw body. A bad or missing signature is `403`.
- A valid `POST` returns `200 OK` straight away. Handling runs in `ctx.waitUntil` when a
  context is given, so Meta does not retry a slow reply. Without a context, it is awaited.
- Handled types: `text`, `image` (the caption becomes the text), and `sticker`. Other types are ignored.
- Media limits: images 5 MB, stickers 1 MB and must be WebP. Anything over the limit, or a
  download error, drops the media and keeps the text.
- Other methods return `405`.

`WhatsappClient`:

- `send(chatId, text, replyTo?)` posts to `graph.facebook.com/v22.0/<phoneNumberId>/messages`
  and includes `context.message_id` when replying. A non-2xx response throws `WhatsappError`.
- `markRead(chatId)` marks a chat as read.
- `downloadMedia(id, maxBytes)` looks up the URL, checks `file_size`, downloads with the same
  token, and checks the byte count again.

The channel name is `"whatsapp"`. Dedupe and rate-limit keys use it, so keys written before the
rename stop matching. They expire on their own within minutes.

## Linked device (Baileys)

```ts
import { attachBot, connectWhatsappSocket } from "@persona/whatsapp";

const sock = await connectWhatsappSocket({
  authDir: ".auth",         // session credentials; keep out of git
  reconnect: true,
  onStatus: (s) => console.log(s),
  onSocket: (s) => attachBot(s, bot, { includeImages: false }),
});
```

- `connectWhatsappSocket` prints a QR code on first login and saves credentials to `authDir` on every update.
- `attachBot` handles only `notify` upserts. It calls `toIncoming` for each message and passes the result to `bot.handle`.
- `toIncoming` ignores your own messages, non-user chats, non-WebP stickers, and messages with neither text nor kept media. It sets `isGroup`, `mentionsBot` and `repliesToBot` from the context.
- `WhatsappSocketChannel` serializes sends. Each send shows a typing indicator for up to 3 seconds (50 ms per character), then waits 2 to 8 seconds before the next one. That pacing is deliberate. Do not remove it to speed up tests.
- `listGroups(sock)` lists groups with their ids, participant counts and subjects. `withSocket(fn, { authDir })` opens a short-lived socket for scripts such as `examples/bot/scripts/groups.ts`.
- `runOnNode(bot, opts)` connects, attaches the bot, and closes the socket on SIGINT or SIGTERM.
- `useKeyValueAuthState(storage, prefix)` stores Baileys auth in any store with `get`, `put` and `delete`. The container keeps it on disk through `AUTH_DIR`.

## Reconnects

After a transient disconnect, `connectWhatsappSocket` reconnects after 3 seconds (when
`reconnect` is on). Only a disconnect whose Boom error has `output.statusCode` equal to
`DisconnectReason.loggedOut` (401) is reported as `logged out`, and it does not reconnect. Regression
tests: `packages/whatsapp/tests/connect-reconnect.test.ts`.

## Gotchas

- The Cloud API handler is a library. It does not decide who the bot answers. Use `policy` in `createPersona` to set that.
- Pause, allowlists and per-chat rules are not managed by the transport. Add them in the SDK policy or in your channel wrapper.
- Never log message text. The SDK logs ids and reasons only.

## Exports

- `WhatsappClient`
- `WhatsappError`
- `createWhatsappWebhook`
- `connectWhatsappSocket`
- `WhatsappSocketChannel`
- `attachBot`
- `toIncoming`
- `listGroups`
- `useKeyValueAuthState`
- `runOnNode`
- `withSocket`

## Related

- Bot wiring: [persona-sdk](../persona-sdk/SKILL.md), [persona-example-bot](../persona-example-bot/SKILL.md)
- Storing auth and state: `@persona/postgres`
- Tests: `tests/integration/cloud-webhook-flow.test.ts`, `packages/whatsapp/tests/`
