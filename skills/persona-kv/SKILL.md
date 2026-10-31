---
name: persona-kv
description: Use @persona/kv to store bot state in a key-value backend such as Cloudflare Workers KV: chat history, dedupe keys, fixed-window rate limits and the pause flag. Covers key layout, TTLs, the flush rule for pause state, and the consistency limits. Use when you persist state or debug state that survives or disappears between runs.
modules:
  - packages/kv/src/index.ts
---

# persona-kv

`@persona/kv` adapts a small key-value interface to the SDK's ports. It works with
Workers KV and with any object that has the same three methods.

## The interface

```ts
export interface KVStorage {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, opts?: { expirationTtl?: number }) => Promise<void>;
  delete: (key: string) => Promise<void>;
}
```

Values are strings. The adapters serialize JSON themselves.

## Adapters

| Adapter | Port it fills | Keys | Behavior |
|---|---|---|---|
| `kvHistoryStore(kv)` | `HistoryStore` | `chat:<chatId>` | Stores the last 20 turns as a JSON array. A corrupt entry loads as `[]`. |
| `kvDedupeStore(kv)` | `DedupeStore` | `dedupe:<channel>:<msgId>` | Writes `"1"` with `expirationTtl` = max(ttl in seconds, 60). |
| `kvRateLimiter(kv, opts)` | `RateLimiter` | `rl:<key>` | Fixed window as JSON `{ start, count }`. TTL = max(window seconds, 60). |
| `loadKvBotState(kv)` | `BotState` | `bot:paused` | Returns a `PersistentBotState` with `paused`, `setPaused`, and `flush()`. |

Defaults: `maxPerWindow` 5, `windowMs` 600000 for the rate limiter. Pause key is `bot:paused`.

## Wiring into the SDK

```ts
import { createMemory } from "@persona/memory";
import { createPersona } from "@persona/persona";
import { kvDedupeStore, kvHistoryStore, kvRateLimiter, loadKvBotState } from "@persona/kv";

const state = await loadKvBotState(kv);   // read once per request
const memory = {
  ...createMemory(),
  history: kvHistoryStore(kv),
  dedupe: kvDedupeStore(kv),
  rateLimiter: kvRateLimiter(kv, { maxPerWindow: 5, windowMs: 600_000 }),
  state,
};
const bot = createPersona({ persona, channel, generator, memory });
```

The example Worker does this (`examples/bot/src/worker.ts`) and calls
`await state.flush()` after each handled message.

## The flush rule

`PersistentBotState.paused` is read synchronously, but writes go to KV in the
background. Call `flush()` before the response ends, or a pause may not be saved
when the isolate goes away. `setPaused` chains writes, so the last value wins.

## Consistency limits

- History is read-modify-write. Two messages for the same chat that arrive at
  once can overwrite each other's turns.
- The rate limiter reads, then writes. Concurrent requests can both pass the
  limit, so it is approximate.
- KV is eventually consistent across locations. Dedupe can miss a duplicate that
  arrives on another edge before the write propagates.

These are acceptable for a chat bot, but do not use this for money or quotas.

## Gotchas

- Keys are not namespaced per bot. Use a separate KV namespace per deployment.
- A corrupt history or rate-limit entry is treated as empty (history) or a fresh window (limiter), so bad data does not crash a reply.
- The learning state key (`learning:state`) is written by `LearningSystem` through its own `LearningStore`. It does not come from this package.

## Exports

- `kvHistoryStore`
- `kvDedupeStore`
- `kvRateLimiter`
- `loadKvBotState`

Types: `KVStorage`, `KvRateLimiterOptions`, `PersistentBotState`.

## Related

- Wrangler binding (`CONVERSATIONS`): [persona-example-bot](../persona-example-bot/SKILL.md)
- Memory API: [persona-memory](../persona-memory/SKILL.md)
- Tests: `tests/integration/kv-persistence.test.ts`, `packages/kv/tests/`
