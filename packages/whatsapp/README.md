# @persona/whatsapp

WhatsApp transports for the persona bot, in one package with two entry points.

| Import                              | What it is                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| `@persona/whatsapp/cloud`           | WhatsApp Cloud API: webhook, Graph API client, media download. Runs on Workers. |
| `@persona/whatsapp/baileys`         | Linked device through Baileys. Long-running Node process.                       |
| `@persona/whatsapp/baileys/node`    | `runOnNode` and `withSocket` for a Node process.                                |
| `@persona/whatsapp/baileys/ws-shim` | Fetch-based WebSocket replacement for Baileys on Workers.                       |

Keep the entry points separate in your bundle: the Worker imports only `/cloud`, so Baileys
is not bundled into it.

## Cloud API

- `createCloudApiWebhook({ bot, appSecret, verifyToken, phoneNumberId, downloadMedia? })`:
  returns `(req, ctx?) => Promise<Response>`. `GET` answers the verify handshake. `POST`
  checks the signature (403 on failure), then passes messages to `bot.handle`. Pass the
  Workers `ExecutionContext` as `ctx` so replies run after the 200 response.
- `CloudApiClient({ phoneNumberId, accessToken, graphVersion?, fetch? })`: implements
  `Channel`. Methods: `send`, `markRead`, `downloadMedia(id, maxBytes)`.
- Signature and handshake checks use `@openchannelprotocol/sdk` (pinned to 0.1.0). Payload
  parsing is ours, so every message in a batch is handled.
- Images (5 MB) and WebP stickers (1 MB) are downloaded when `downloadMedia` is given.

## Linked device (Baileys)

- `connectBaileys(opts)`: connects, and calls `onSocket` for every new socket, including
  after reconnects.
- `attachBot(sock, bot, opts)`: routes incoming messages to a `MessageHandler`.
- `toIncoming(sock, msg, opts)`: async. Downloads images and stickers, with the same limits.
- `BaileysChannel`: serialized sends with typing indicators.
- `useKeyValueAuthState`, `listGroups`, `runOnNode`, `withSocket`.

See `examples/bot/src/node.ts` for the wiring.
