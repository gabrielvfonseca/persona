---
name: persona-memory
description: Use @persona/memory for chat history, memory nodes, shared knowledge, keyword (BM25) and semantic (cosine) recall fused by weighted reciprocal rank, dedupe and fixed-window rate limits. Use when you change what the bot remembers or how it searches that memory.
modules:
  - packages/memory/src/index.ts
---

# persona-memory

`createMemory()` returns everything a bot keeps between messages in one object.
It is in-process by default. Persist it by passing your own stores (see
`@persona/postgres`).

## createMemory

```ts
import { createMemory } from "@persona/memory";

const memory = createMemory({
  maxTurns: 20,          // turns returned by history.load
  maxNodes: 10_000,      // oldest nodes are evicted past this count
  rateWindowMs: 600_000, // rate limit window
  maxPerWindow: 5,       // model calls per chat per window
  embedder,              // optional: enables semantic recall
  recallWeights: { keywordWeight: 1, semanticWeight: 1, rrfK: 60 },
});
```

| Field | What it is |
|---|---|
| `nodes` | `NodeStore`: every stored text, indexed by BM25 and by embedding. |
| `history` | `MemoryHistoryStore`: a `HistoryStore` backed by turn nodes. |
| `dedupe` | `MemoryDedupeStore`: message-id dedupe with a TTL. |
| `rateLimiter` | `FixedWindowRateLimiter`: one window per key. |
| `state` | `MemoryBotState`: the pause flag. |

Methods:

- `remember(chatId, text, kind?)` adds a node to one chat. Kinds: `turn`, `fact`, `quote`.
- `learn(text)` adds shared knowledge. It is stored under `KNOWLEDGE_CHAT` (`"*"`),
  which every chat can recall.
- `recall(chatId, query, limit = 5)` returns the best nodes from that chat and
  from shared knowledge.
- `setRecallWeights(w)` changes the fusion weights at runtime.

## How recall works

1. Keyword: BM25 over the query, restricted to the chat and `"*"`.
2. Semantic: if an embedder is set, the query is embedded and compared by cosine
   similarity to embedded nodes. If embedding fails, this step is empty and
   recall is keyword-only. Nothing throws.
3. Fusion: `weightedReciprocalRankFusion` merges both ranked lists. Each list adds
   `weight / (k + rank + 1)`, so `keywordWeight`, `semanticWeight` and `rrfK` shift the balance.

The learning engine tunes those three weights (see [persona-learning](../persona-learning/SKILL.md)).

## Nodes and history

- Node ids are `${chatId}#${seq}`. Insertion order is kept, so `recent(chatId, n)`
  returns the last `n` nodes oldest first.
- `NodeStore.add` indexes text and, if present, the embedding. Eviction removes a node from both indexes.
- `MemoryHistoryStore.append` embeds each turn when an embedder is set. `load`
  returns only `turn` nodes, as `{ role, content }`.
- History is not capped by time, only by `maxTurns` on read. Older turns stay
  searchable through `nodes`.

## Dedupe and rate limits

- `MemoryDedupeStore` keeps keys until their TTL expires. It sweeps expired keys
  on each call and caps the size at 10,000 entries.
- `FixedWindowRateLimiter.allow(key)` counts per key. The pipeline uses
  `${channel.name}:${chatId}`, so one chat cannot use up another's limit.
  Counting happens on every model call, including failed ones.

## Gotchas

- `NodeStore.search` and `nearest` take `chatIds`. Pass `[chatId, KNOWLEDGE_CHAT]` to include shared knowledge.
- `embedOrUndefined` returns `undefined` for an embedder that throws, or one that
  returns the wrong number of vectors. A failed embedding never stops a reply.
- `NodeStore` and the dedupe store are in-memory. A restart clears them.

## Exports

- `createMemory`
- `MemoryBotState`
- `MemoryDedupeStore`
- `MemoryHistoryStore`
- `DEFAULT_MAX_TURNS`
- `NodeStore`
- `KNOWLEDGE_CHAT`
- `cosine`
- `SearchIndex`
- `tokenize`
- `reciprocalRankFusion`
- `weightedReciprocalRankFusion`
- `fuse`
- `fuseWeighted`
- `FixedWindowRateLimiter`
- `embedOrUndefined`

## Related

- Pipeline that calls these: [persona-sdk](../persona-sdk/SKILL.md)
- Persisting them to KV: `@persona/postgres`
- Unit tests: `tests/unit/pure-functions.test.ts`, `packages/memory/tests/`
