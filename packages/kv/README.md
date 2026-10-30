# @persona/kv

Key-value storage for the persona bot. Works with any store that has `get`, `put` and
`delete`, such as a Cloudflare KV namespace.

- `kvHistoryStore(kv)`: chat history. Concurrent messages in one chat can overwrite each
  other, because KV has no transactions.
- `kvDedupeStore(kv)`: remembers message ids for a while, so a retried webhook is not
  answered twice.
- `loadKvBotState(kv)`: pause state. Load it once per request, and `flush()` it before the
  response is sent.
- `kvRateLimiter(kv, { windowMs, maxPerWindow })`: fixed-window limit per key. Approximate
  under concurrency.
