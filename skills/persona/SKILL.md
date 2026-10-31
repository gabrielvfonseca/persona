---
name: persona
description: Project map and entry point for the persona monorepo, a toolkit that builds a WhatsApp bot which learns a personality from a persona file and replies in its voice. Use first when you do not know which package or skill applies.
modules:
  - packages/persona/src/index.ts
---

# persona

A toolkit for a WhatsApp bot that replies in a learned voice. The SDK is split
into small packages. `examples/bot` is the one app that wires them to a model
provider and a transport.

## Project map

| Package | Role | Skill |
|---|---|---|
| `@persona/core` | Ports and types only: `Channel`, `HistoryStore`, `ReplyGenerator`, `Turn`, `HandleResult`. No runtime code. | [persona-sdk](../persona-sdk/SKILL.md) |
| `@persona/schemas` | The persona file format (`personaV1`) and `parsePersona`. | [persona-schemas](../persona-schemas/SKILL.md) |
| `@persona/memory` | History, memory nodes, BM25 + cosine recall, dedupe, rate limits. | [persona-memory](../persona-memory/SKILL.md) |
| `@persona/policy` | When to reply (`createReplyPolicy`) and admin commands (`createCommands`). | [persona-policy](../persona-policy/SKILL.md) |
| `@persona/learning` | Outcomes, ratings, weight tuning, distillation, fine-tune dataset. | [persona-learning](../persona-learning/SKILL.md) |
| `@persona/persona` | The main SDK: `createPersona` and `createPersonaBot`. | [persona-sdk](../persona-sdk/SKILL.md) |
| `@persona/kv` | Key-value adapters for history, dedupe, rate limits and pause state. | [persona-kv](../persona-kv/SKILL.md) |
| `@persona/whatsapp` | Transports: Cloud API (`/cloud`) and linked device via Baileys (`/baileys`). | [persona-whatsapp](../persona-whatsapp/SKILL.md) |
| `examples/bot` | The app: config, OpenRouter model adapters, Node and Worker entry points. | [persona-example-bot](../persona-example-bot/SKILL.md) |

Dependency rules live in `docs/PACKAGES.md` and are enforced by
`bun scripts/index.ts check-deps`. Only `examples/*` may import a model provider
(`ai`, `@openrouter/ai-sdk-provider`) or Hono.

## The reply pipeline

Every inbound message goes through `createPersonaBot().handle()`. It never throws.

```
dedupe → command → paused? → policy → rate limit → describe media →
generate → transforms → empty check → guards → send → history → learning
```

`HandleResult` is one of:

- `{ kind: "replied" }`: sent.
- `{ kind: "command" }`: an admin or public command ran (no model call).
- `{ kind: "skipped", reason }`: `duplicate`, `paused`, `not-addressed`,
  `rate-limited`, `empty`, or `guard`.
- `{ kind: "failed", error }`: generation or sending failed.

Ordering rules that matter:

- Commands run before the pause check, so an admin can `!resume` a paused bot.
- History is written only after a successful send.
- The rate limiter counts every model call, including failed ones.

## Quick start

```bash
bun install
bun run test                                  # every package's tests (turbo)
bun run --cwd examples/bot simulate           # offline run, fake model, no keys
bun run --cwd examples/bot bot                # linked device, needs .env (see persona-example-bot)
```

Wrong or missing config? Start with [persona-example-bot](../persona-example-bot/SKILL.md).

## Safety defaults

- The bot will not run unless `PERSONA_CONSENT` is exactly `"true"`. Only set it
  when the person whose voice is copied has consented.
- Admin commands need a configured admin number (`ADMIN_NUMBERS`, or `admins` in
  the SDK). Without one, no one can pause the bot.
- Replies are rate limited per chat (`MAX_PER_10MIN`, default 5).
- Replies that copy a persona quote (20+ characters) are dropped by `noEcho`.
- Message text is never logged. Only ids and reasons are.

## Known gaps (read before you rely on them)

- `README.md` and `DEPLOY.md` document `bun run ingest`, and `persona-file.ts`
  tells users to run it, but the ingest command and `@persona/training` were
  removed. Persona files must be written by hand or produced elsewhere.
  See [persona-schemas](../persona-schemas/SKILL.md).
- `createPersona` ignores `prompt.maxWords`. Use `weights.maxWords` or
  `setPromptWeights` until that is fixed. See [persona-sdk](../persona-sdk/SKILL.md).
- `!learn` replies "Learned." but stores nothing. See [persona-policy](../persona-policy/SKILL.md).
- Linked-device reconnects treat every disconnect as a logout. See [persona-whatsapp](../persona-whatsapp/SKILL.md).

The tests that pin these are listed in [persona-testing](../persona-testing/SKILL.md).

## Where to go next

- Build or change a bot: [persona-sdk](../persona-sdk/SKILL.md)
- Change what the bot says yes to: [persona-policy](../persona-policy/SKILL.md)
- Change how it remembers: [persona-memory](../persona-memory/SKILL.md)
- Change how it learns: [persona-learning](../persona-learning/SKILL.md)
- Run, deploy or configure the app: [persona-example-bot](../persona-example-bot/SKILL.md)
- Run or add tests: [persona-testing](../persona-testing/SKILL.md)

## Exports

The overview has no runtime exports of its own. The SDK entry point is
documented in [persona-sdk](../persona-sdk/SKILL.md).
