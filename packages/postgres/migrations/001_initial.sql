-- Initial schema for the persona bot. Every statement is idempotent, so the
-- file runs on every startup. Embedding width is fixed at 384 (see README).
CREATE EXTENSION IF NOT EXISTS vector;

-- Key-value state: chat turns, dedupe keys, rate-limit windows, pause flag,
-- learning state, dataset exports. expires_at is NULL for keys that never expire.
CREATE TABLE IF NOT EXISTS kv (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS kv_expires_at_idx ON kv (expires_at) WHERE expires_at IS NOT NULL;

-- Memory nodes: facts, quotes and turns. `tsv` backs keyword search,
-- `embedding` backs semantic search (NULL when the node was not embedded).
CREATE TABLE IF NOT EXISTS pg_nodes (
  id         text PRIMARY KEY,
  chat_id    text NOT NULL,
  kind       text NOT NULL,
  role       text,
  text       text NOT NULL,
  embedding  vector(384),
  tsv        tsvector GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED,
  created_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS pg_nodes_chat_created_idx ON pg_nodes (chat_id, created_at);
CREATE INDEX IF NOT EXISTS pg_nodes_created_idx ON pg_nodes (created_at, id);
CREATE INDEX IF NOT EXISTS pg_nodes_tsv_idx ON pg_nodes USING gin (tsv);
CREATE INDEX IF NOT EXISTS pg_nodes_embedding_idx ON pg_nodes USING hnsw (embedding vector_cosine_ops);

-- Graph edges between nodes. Traversed with a recursive CTE (see node-store.ts).
CREATE TABLE IF NOT EXISTS pg_edges (
  source_id  text NOT NULL REFERENCES pg_nodes (id) ON DELETE CASCADE,
  target_id  text NOT NULL REFERENCES pg_nodes (id) ON DELETE CASCADE,
  rel_type   text NOT NULL,
  weight     real NOT NULL DEFAULT 1,
  created_at bigint NOT NULL,
  PRIMARY KEY (source_id, target_id, rel_type)
);
CREATE INDEX IF NOT EXISTS pg_edges_target_idx ON pg_edges (target_id);
