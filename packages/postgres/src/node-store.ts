import { randomUUID } from "node:crypto";
import type pg from "pg";
import { toVectorLiteral } from "./db";

const PATTERN_1 = /[\p{L}\p{N}]+/gu;

export type NodeKind = "turn" | "fact" | "quote";

/**
 * Width of every stored embedding. The `pg_nodes.embedding` column is
 * `vector(384)`; an embedder of another width must be migrated first.
 */
export const EMBEDDING_DIMENSIONS = 384;

/** Throws unless the vector has the width the schema stores. */
export function assertEmbeddingWidth(vector: readonly number[]): void {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `embedding has ${vector.length} dimensions; the schema stores ${EMBEDDING_DIMENSIONS}`
    );
  }
}

/** Chat id for knowledge shared by every chat. Matches the in-memory store. */
export const KNOWLEDGE_CHAT = "*";

export interface PgNode {
  chatId: string;
  createdAt: number;
  embedding?: number[] | undefined;
  id: string;
  kind: NodeKind;
  role?: "user" | "assistant" | undefined;
  text: string;
}

export interface NewPgNode {
  chatId: string;
  createdAt?: number | undefined;
  embedding?: readonly number[] | undefined;
  /** Fixed id, so importing the same message twice adds nothing. Random when omitted. */
  id?: string | undefined;
  kind: NodeKind;
  role?: "user" | "assistant" | undefined;
  text: string;
}

export interface PgScoredNode extends PgNode {
  score: number;
}

export interface PgNodeStoreOptions {
  /** Oldest nodes are deleted past this count. */
  maxNodes?: number | undefined;
  now?: (() => number) | undefined;
}

export interface PgSearchOptions {
  /** Only nodes from these chats. Omit to search every chat. */
  chatIds?: readonly string[] | undefined;
  limit?: number | undefined;
}

/** A node reached by walking edges from a root, with its distance in hops. */
export interface Reached {
  depth: number;
  node: PgNode;
}

interface NodeRow {
  chat_id: string;
  created_at: string;
  embedding: string | null;
  id: string;
  kind: NodeKind;
  role: "user" | "assistant" | null;
  text: string;
}

const NODE_COLUMNS =
  "id, chat_id, kind, role, text, embedding::text AS embedding, created_at";

/** Parses pgvector's text form, `[0.1,0.2]`. */
function parseVector(raw: string | null): number[] | undefined {
  if (!raw) {
    return undefined;
  }
  return raw
    .slice(1, -1)
    .split(",")
    .map((x) => Number(x));
}

function toNode(row: NodeRow): PgNode {
  const node: PgNode = {
    chatId: row.chat_id,
    createdAt: Number(row.created_at),
    id: row.id,
    kind: row.kind,
    text: row.text,
  };
  if (row.role) {
    node.role = row.role;
  }
  const embedding = parseVector(row.embedding);
  if (embedding) {
    node.embedding = embedding;
  }
  return node;
}

/** Splits a query into the lowercased letter and digit runs, as the in-memory index does. */
function queryTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().match(PATTERN_1) ?? [])];
}

/**
 * Memory nodes in Postgres. Keyword search uses full-text (`tsv`), semantic
 * search uses pgvector cosine distance, and `pg_edges` links nodes into a graph
 * that `traverse` walks with a recursive CTE.
 */
export class PgNodeStore {
  private readonly pool: pg.Pool;
  private readonly maxNodes: number;
  private readonly now: () => number;

  constructor(pool: pg.Pool, opts: PgNodeStoreOptions = {}) {
    this.pool = pool;
    this.maxNodes = opts.maxNodes ?? 50_000;
    this.now = opts.now ?? Date.now;
  }

  async add(input: NewPgNode): Promise<PgNode> {
    const node: PgNode = {
      chatId: input.chatId,
      createdAt: input.createdAt ?? this.now(),
      id: input.id ?? randomUUID(),
      kind: input.kind,
      text: input.text,
    };
    if (input.role) {
      node.role = input.role;
    }
    if (input.embedding) {
      assertEmbeddingWidth(input.embedding);
      node.embedding = [...input.embedding];
    }
    await this.pool.query(
      `INSERT INTO pg_nodes (id, chat_id, kind, role, text, embedding, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        node.id,
        node.chatId,
        node.kind,
        node.role ?? null,
        node.text,
        node.embedding ? toVectorLiteral(node.embedding) : null,
        node.createdAt,
      ]
    );
    await this.evict();
    return node;
  }

  /**
   * Adds many nodes in one statement, then evicts once. Existing ids are skipped.
   * Use this for bulk imports; `add` is for one node at a time.
   */
  async addMany(
    inputs: readonly NewPgNode[],
    opts: { evict?: boolean | undefined } = {}
  ): Promise<number> {
    if (inputs.length === 0) {
      return 0;
    }
    const now = this.now();
    const rows = inputs.map((input) => {
      if (input.embedding) {
        assertEmbeddingWidth(input.embedding);
      }
      return {
        chatId: input.chatId,
        createdAt: input.createdAt ?? now,
        embedding: input.embedding ? toVectorLiteral(input.embedding) : null,
        id: input.id ?? randomUUID(),
        kind: input.kind,
        role: input.role ?? null,
        text: input.text,
      };
    });
    const result = await this.pool.query(
      `INSERT INTO pg_nodes (id, chat_id, kind, role, text, embedding, created_at)
       SELECT id, chat_id, kind, role, text, emb::vector, created_at
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::bigint[])
              AS t(id, chat_id, kind, role, text, emb, created_at)
       ON CONFLICT (id) DO NOTHING`,
      [
        rows.map((r) => r.id),
        rows.map((r) => r.chatId),
        rows.map((r) => r.kind),
        rows.map((r) => r.role),
        rows.map((r) => r.text),
        rows.map((r) => r.embedding),
        rows.map((r) => r.createdAt),
      ]
    );
    if (opts.evict !== false) {
      await this.evict();
    }
    return result.rowCount ?? 0;
  }

  async get(id: string): Promise<PgNode | undefined> {
    const { rows } = await this.pool.query<NodeRow>(
      `SELECT ${NODE_COLUMNS} FROM pg_nodes WHERE id = $1`,
      [id]
    );
    return rows[0] ? toNode(rows[0]) : undefined;
  }

  async count(): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pg_nodes"
    );
    return Number(rows[0]?.n ?? 0);
  }

  /** The last `limit` nodes of a chat, oldest first. Knowledge is not included. */
  async recent(
    chatId: string,
    limit: number,
    kind?: NodeKind
  ): Promise<PgNode[]> {
    const { rows } = await this.pool.query<NodeRow>(
      `SELECT ${NODE_COLUMNS} FROM (
         SELECT * FROM pg_nodes
          WHERE chat_id = $1 AND ($3::text IS NULL OR kind = $3)
          ORDER BY created_at DESC, id DESC
          LIMIT $2
       ) recent
       ORDER BY created_at ASC, id ASC`,
      [chatId, limit, kind ?? null]
    );
    return rows.map(toNode);
  }

  /** Keyword matches, best first. Any query term may match (OR), scored by ts_rank_cd. */
  async search(
    query: string,
    opts: PgSearchOptions = {}
  ): Promise<PgScoredNode[]> {
    const terms = queryTerms(query);
    if (terms.length === 0) {
      return [];
    }
    const tsquery = terms.map((t) => `'${t}'`).join(" | ");
    const { rows } = await this.pool.query<NodeRow & { score: number }>(
      `SELECT ${NODE_COLUMNS}, ts_rank_cd(tsv, q) AS score
         FROM pg_nodes, to_tsquery('simple', $1) q
        WHERE tsv @@ q AND ($2::text[] IS NULL OR chat_id = ANY($2::text[]))
        ORDER BY score DESC, created_at DESC
        LIMIT $3`,
      [tsquery, opts.chatIds ? [...opts.chatIds] : null, opts.limit ?? 5]
    );
    return rows.map((row) => ({ ...toNode(row), score: Number(row.score) }));
  }

  /** Nearest embedded nodes by cosine similarity, best first. `score` is 1 minus the distance. */
  async nearest(
    vector: readonly number[],
    opts: PgSearchOptions = {}
  ): Promise<PgScoredNode[]> {
    assertEmbeddingWidth(vector);
    const { rows } = await this.pool.query<NodeRow & { score: number }>(
      `SELECT ${NODE_COLUMNS}, 1 - (embedding <=> $1::vector) AS score
         FROM pg_nodes
        WHERE embedding IS NOT NULL
          AND ($2::text[] IS NULL OR chat_id = ANY($2::text[]))
        ORDER BY embedding <=> $1::vector
        LIMIT $3`,
      [
        toVectorLiteral(vector),
        opts.chatIds ? [...opts.chatIds] : null,
        opts.limit ?? 5,
      ]
    );
    return rows.map((row) => ({ ...toNode(row), score: Number(row.score) }));
  }

  /**
   * Adds many directed edges in one statement. Re-adding the same (source, target, type)
   * updates its weight. Returns how many edges were written.
   */
  async linkMany(
    edges: readonly {
      source: string;
      target: string;
      rel: string;
      weight?: number | undefined;
    }[]
  ): Promise<number> {
    // Identical messages can produce the same edge twice; keep the last weight, since
    // one statement may not update the same row twice.
    const unique = new Map<string, (typeof edges)[number]>();
    for (const edge of edges) {
      unique.set(`${edge.source}\u0000${edge.target}\u0000${edge.rel}`, edge);
    }
    const batch = [...unique.values()];
    if (batch.length === 0) {
      return 0;
    }
    const now = this.now();
    const result = await this.pool.query(
      `INSERT INTO pg_edges (source_id, target_id, rel_type, weight, created_at)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::real[], $5::bigint[])
       ON CONFLICT (source_id, target_id, rel_type) DO UPDATE SET weight = EXCLUDED.weight`,
      [
        batch.map((e) => e.source),
        batch.map((e) => e.target),
        batch.map((e) => e.rel),
        batch.map((e) => e.weight ?? 1),
        batch.map(() => now),
      ]
    );
    return result.rowCount ?? 0;
  }

  /** Adds a directed edge. Re-adding the same (source, target, type) updates its weight. */
  async link(
    sourceId: string,
    targetId: string,
    relType: string,
    weight = 1
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO pg_edges (source_id, target_id, rel_type, weight, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_id, target_id, rel_type) DO UPDATE SET weight = EXCLUDED.weight`,
      [sourceId, targetId, relType, weight, this.now()]
    );
  }

  /**
   * Nodes reachable from `rootId` within `maxDepth` hops along outgoing edges.
   * The root is excluded. Each node is reported once, at its shortest depth.
   */
  async traverse(rootId: string, maxDepth: number): Promise<Reached[]> {
    const { rows } = await this.pool.query<NodeRow & { depth: number }>(
      `WITH RECURSIVE walk (id, depth) AS (
         SELECT $1::text, 0
         UNION
         SELECT e.target_id, w.depth + 1
           FROM walk w
           JOIN pg_edges e ON e.source_id = w.id
          WHERE w.depth < $2
       ),
       shortest AS (
         SELECT id, MIN(depth) AS depth FROM walk WHERE id <> $1 GROUP BY id
       )
       SELECT n.id, n.chat_id, n.kind, n.role, n.text,
              n.embedding::text AS embedding, n.created_at, s.depth
         FROM shortest s
         JOIN pg_nodes n ON n.id = s.id
        ORDER BY s.depth, n.created_at, n.id`,
      [rootId, maxDepth]
    );
    return rows.map((row) => ({ depth: Number(row.depth), node: toNode(row) }));
  }

  /** Deletes the oldest nodes until at most `maxNodes` remain. Edges go with them. */
  private async evict(): Promise<void> {
    await this.pool.query(
      `DELETE FROM pg_nodes WHERE id IN (
         SELECT id FROM pg_nodes
          ORDER BY created_at ASC, id ASC
          LIMIT GREATEST((SELECT count(*) FROM pg_nodes) - $1, 0)
       )`,
      [this.maxNodes]
    );
  }
}
