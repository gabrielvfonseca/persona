---
name: persona-whatsapp
description: Connect the persona bot to WhatsApp through @persona/whatsapp, either the official Cloud API webhook (Workers-friendly, /cloud subpath) or a linked device over Baileys (Node, /baileys subpath). Covers the webhook handshake and signatures, media limits, send pacing, QR login, auth storage, group lookup and known reconnect problems.
modules:
  - packages/whatsapp/src/cloud/index.ts
  - packages/whatsapp/src/baileys/index.ts
---

# persona-whatsapp

Two transports, each its own subpath so a bundle includes only what it uses.
Both implement the core `Channel` and produce `IncomingMessage` values for the SDK.

| Transport | Import | Runs on | Account |
|---|---|---|---|
| Cloud API | `@persona/whatsapp/cloud` | Workers or any HTTP host | Official Meta WhatsApp Business app |
| Linked device | `@persona/whatsapp/baileys` | Node, with a persistent disk | Your WhatsApp account, via QR |

Only one linked-device instance may run per WhatsApp account.

## Cloud API

```ts
import { CloudApiClient, createCloudApiWebhook } from "@persona/whatsapp/cloud";

const client = new CloudApiClient({ phoneNumberId, accessToken }); // implements Channel
const webhook = createCloudApiWebhook({
  bot,                                   // any MessageHandler, e.g. createPersona(...)
  appSecret,                             // verifies X-Hub-Signature-256
  verifyToken,                           // matched against hub.verify_token
  phoneNumberId,                         // only messages to this number are handled
  downloadMedia: (id, maxBytes) => client.downloadMedia(id, maxBytes),
});

// Workers: app.post("/webhook/whatsapp", (c) => webhook(c.req.raw, c.executionCtx));
```

Behavior:

- `GET` answers the Meta handshake. It returns the challenge when the token matches, otherwise `403`.
- `POST` checks the signature over the raw body. A bad or missing signature is `403`.
- A valid `POST` returns `200 OK` straight away. Handling runs in `ctx.waitUntil` when a
  context is given, so Meta does not retry a slow reply. Without a context, it is awaited.
- Handled types: `text`, `image` (caption becomes the text), and `sticker`. Other types are ignored.
- Media limits: images 5 MB, stickers 1 MB and must be WebP. Anything over the limit, or a download error, drops the media and keeps the text.
- Other methods return `405`.

`CloudApiClient`:

- `send(chatId, text, replyTo?)` posts to `graph.facebook.com/v22.0/<phoneNumberId>/messages`
  and includes `context.message_id` when replying. Non-2xx responses throw `CloudApiError`.
- `markRead(chatId)` marks a chat as read.
- `downloadMedia(id, maxBytes)` looks up the URL, checks `file_size`, downloads with
  the same token, and checks the byte count again.

## Linked device (Baileys)

```ts
import { attachBot, BaileysChannel, connectBaileys } from "@persona/whatsapp/baileys";

const sock = await connectBaileys({
  authDir: ".auth",         // session credentials; keep out of git
  reconnect: true,
  onStatus: (s) => console.log(s),
  onSocket: (s) => attachBot(s, bot, { includeImages: false }),
});
```

- `connectBaileys` prints a QR code in the terminal on first login and saves credentials to `authDir` on every update.
- `attachBot` handles only `notify` upserts. It calls `toIncoming` for each message and passes the result to `bot.handle`.
- `toIncoming` ignores your own messages, non-user chats, non-WebP stickers, and messages with neither text nor kept media. It sets `isGroup`, `mentionsBot` and `repliesToBot` from the context.
- `BaileysChannel` serializes sends. Each send shows a typing indicator for up to 3 seconds (50 ms per character), then waits 2 to 8 seconds before the next one. That pacing is deliberate, so do not remove it to speed up tests.
- `listGroups(sock)` lists groups with their ids, participant counts and subjects. `withSocket(fn, { authDir })` opens a short-lived socket for scripts such as `examples/bot/scripts/groups.ts`.
- `runOnNode(bot, opts)` connects, attaches the bot, and closes the socket on SIGINT or SIGTERM.
- `useKeyValueAuthState(storage, prefix)` stores Baileys auth in any KV with `get`, `put` and `delete`. This is how the Worker can hold a session.

## Known issue: reconnects

`connect.ts` sets its `code` to `loggedOut` whenever `lastDisconnect` has any error,
not only a real logout. A transient socket error therefore reports `logged out` and
does not reconnect. The reproduction is `packages/whatsapp/tests/baileys/connect-reconnect.test.ts`
(marked `it.fails`). Fix it by checking the disconnect status code against
`DisconnectReason.loggedOut`.

## Gotchas

- The Cloud API bot only answers direct messages when the persona is named, because `buildBot` sets `direct: "addressed"` for that transport. Use `policy` to change it.
- The Baileys channel is the place to add a pause or an allowlist. The SDK does not manage that for you.
- The Worker build aliases `ws` to `packages/whatsapp/src/baileys/ws-shim.ts`. Baileys' own WebSocket does not run on Workers.
- Never log message text. The SDK logs ids and reasons only.

## Exports

Cloud API:

- `CloudApiClient`
- `createCloudApiWebhook`

Baileys:

- `attachBot`
- `BaileysChannel`
- `connectBaileys`
- `listGroups`
- `toIncoming`
- `useKeyValueAuthState`
- `runOnNode`
- `withSocket`

## Related

- Bot wiring: [persona-sdk](../persona-sdk/SKILL.md), [persona-example-bot](../persona-example-bot/SKILL.md)
- Storing auth and state: [persona-kv](../persona-kv/SKILL.md)
- Tests: `tests/integration/cloud-webhook-flow.test.ts`, `tests/integration/worker-entry.test.ts`, `packages/whatsapp/tests/`
