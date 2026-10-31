# Architecture

The SDK is a set of bounded contexts (see [PACKAGES.md](PACKAGES.md)). `@persona/persona`
puts them together. Transports and model providers plug in through ports defined in
`@persona/core`.

```
            ┌────────────── examples/bot (example) ──────────────┐
            │ config · model (OpenRouter) · node.ts · worker.ts      │
            └───────────────────────┬────────────────────────────┘
                                     │ createPersona()
┌───────────────────────────────────▼────────────────────────────┐
│ @persona/persona   pipeline · prompt · guards · learning        │
│   uses: @persona/memory   @persona/policy   @persona/schemas    │
└───────────────────────────────────┬────────────────────────────┘
                                    │ ports (types)
                        ┌───────────▼───────────┐
                        │ @persona/core         │
                        └───────────▲───────────┘
          @persona/whatsapp (cloud, baileys)   @persona/kv
```

## The Pipeline

Every incoming message flows through `createPersonaBot().handle()`:

```
dedupe → command → paused? → policy → rate limit → describe media →
generate → transforms → empty check → guards → send → history
```

After a reply is sent, the pipeline calls `learning.recordOutcome(...)`. The
learning engine uses that signal to tune `PromptWeights` and `RecallWeights`,
and periodically distills a `PersonaPatch` of facts, phrases and style-guide
lines. Admins can rate replies with `!good`/`!bad` and run `!distill`.

### HandleResult

`handle()` never throws. It returns one of:

- `{ kind: "replied" }`: the message was sent.
- `{ kind: "command" }`: a command (`!whois`, `!pause`, `!resume`, `!good`, `!bad`,
  `!weights`, `!dataset`, `!learn`, `!distill`) ran.
- `{ kind: "skipped", reason }`: no reply. Reasons: `duplicate`, `paused`, `not-addressed`,
  `rate-limited`, `empty`, `guard`.
- `{ kind: "failed", error }`: sending or generating failed.

### Contract

- Commands run before the pause check, so an admin can `!resume` a paused bot.
- Admin checks use `senderId` when given, otherwise `chatId`. Groups should set `senderId`.
- History is appended **only after** `send` succeeds. A failed history write is logged, not thrown.
- Dedupe key is `${channel.name}:${msg.id}`.
- The rate limiter is keyed per chat and counts every model call, including failed ones.
- The system prompt is sent on every model call. Recalled messages are appended to it when `recallLimit > 0`.
- The system prompt may be a getter so the learning engine can swap it at runtime.
- Groups: user turn is `"${senderName}: ${text}"`.

## Dependency Rules

| Package | May depend on |
|---|---|
| `core` | nothing |
| `schemas` | zod |
| `policy` | `core` |
| `memory` | `core` |
| `learning` | `core`, `schemas` |
| `persona` | `core`, `schemas`, `policy`, `memory` |
| `whatsapp` | `core`, zod, `@openchannelprotocol/sdk`, `baileys` (`/baileys` only) |
| `kv` | `core` |
| `examples/*` | anything, including model providers and Hono |

Only `examples/*` may import a model provider (`ai`, `@openrouter/ai-sdk-provider`) or Hono.