# @persona/whatsapp

WhatsApp for persona bots, behind one API. Two ways in, one message shape out.

```ts
import {
  WhatsappClient,
  createWhatsappWebhook, // Cloud API: Meta webhook, any Request handler
  connectWhatsappSocket, // linked device: Baileys socket, runs on Node
  attachBot,
  runOnNode,
} from "@persona/whatsapp";
```

| Transport     | Runs on                      | Account                      | Main exports                                                                                                                                 |
| ------------- | ---------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud API     | Any HTTP host                | Meta WhatsApp Business app   | `createWhatsappWebhook`, `WhatsappClient`, `WhatsappError`                                                                                   |
| Linked device | Node, with a persistent disk | Your WhatsApp account, by QR | `connectWhatsappSocket`, `WhatsappSocketChannel`, `attachBot`, `toIncoming`, `runOnNode`, `withSocket`, `listGroups`, `useKeyValueAuthState` |

Both transports implement `Channel` from `@persona/core` and deliver `IncomingMessage`s to
`createPersona`. Only one linked-device process may run per WhatsApp account.

## Cloud API

- `createWhatsappWebhook({ bot, appSecret, verifyToken, phoneNumberId, downloadMedia? })`
  returns `(req, ctx?) => Response`. `GET` answers the Meta handshake. `POST` verifies
  `X-Hub-Signature-256` over the raw body, then acknowledges with `200` and handles messages,
  in `ctx.waitUntil` when a background context is given (a Workers `ExecutionContext` fits).
- `WhatsappClient({ phoneNumberId, accessToken, graphVersion?, fetch? })` implements
  `Channel`. It also has `markRead(chatId)` and `downloadMedia(id, maxBytes)`.
- `WhatsappError` carries the HTTP `status` and the response `body`.

## Linked device (Baileys)

- `connectWhatsappSocket({ authDir?, reconnect?, onStatus?, onSocket?, version?, logger? })`
  prints a QR code on first login and saves credentials to `authDir` (default `.auth`).
- `attachBot(sock, bot, { includeImages? })` handles `notify` messages and passes each one through `toIncoming`.
- `toIncoming(sock, msg, opts)` skips your own messages, non-user chats, and non-WebP stickers.
- `WhatsappSocketChannel(sock)` serializes sends, with typing indicators and gaps between them.
- `runOnNode(bot, opts)` runs a long-lived bot and closes the socket on SIGINT and SIGTERM.
- `withSocket(fn, { authDir })` opens a short-lived socket for scripts. `listGroups(sock)` uses it.
- `useKeyValueAuthState(storage, prefix)` stores Baileys auth in any key-value store.


## Layout

Flat source, one entry point:

```
src/
  index.ts        the public API
  client.ts       WhatsappClient, WhatsappError (Cloud API)
  webhook.ts      createWhatsappWebhook (Cloud API)
  payload.ts      Cloud API payload parsing
  signature.ts    X-Hub-Signature-256 check
  connect.ts      connectWhatsappSocket (Baileys)
  channel.ts      WhatsappSocketChannel
  attach.ts       attachBot
  message.ts      toIncoming
  groups.ts       listGroups
  auth-state.ts   useKeyValueAuthState
  node.ts         runOnNode, withSocket
  media.ts        WebP check, shared by both transports
```

## Reconnects

Only a disconnect with the logged-out status code (401) is reported as `logged out`. Any other
disconnect reconnects after 3 seconds. Regression tests: `tests/connect-reconnect.test.ts`.

## Tests

```bash
bun run test     # from this directory, or `bunx vitest run tests/webhook.test.ts`
```
