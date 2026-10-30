# @persona/memory

Conversation memory for one bot.

- `createMemory(opts?)`: returns `{ nodes, history, dedupe, rateLimiter, state, recall }`.
- `NodeStore`: keeps every message as a node per chat and indexes its text.
- `SearchIndex`: BM25 index with Unicode-aware tokens.
- `MemoryHistoryStore`: the `HistoryStore` the bot reads. It returns the last `maxTurns`
  (default 20); older turns stay searchable.

Memory lives in the process. For persistence, pass your own `HistoryStore`, such as the
KV store in `@persona/kv`.
