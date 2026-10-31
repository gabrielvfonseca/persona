import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";

const { Pool } = pg;

export type { Pool } from "pg";

/** Stable key for the migration advisory lock. Any constant works; it must not change. */
const MIGRATION_LOCK = 735_201;

/** Every migration file, in name order. Each is idempotent, so all of them run on every start. */
const migrationSql = readdirSync(new URL("../migrations/", import.meta.url))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) =>
    readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8")
  )
  .join("\n");

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new Pool({ connectionString, max });
}

/**
 * Applies the schema. Safe to call on every startup and from several processes
 * at once: an advisory lock serializes them.
 */
export async function migrate(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Building an index on a large table can outlast the server's statement timeout.
    await client.query("SET LOCAL statement_timeout = 0");
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK]);
    await client.query(migrationSql);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
      /* intentionally empty */
    });
    throw err;
  } finally {
    client.release();
  }
}

/** Formats a vector as a pgvector literal, e.g. `[0.1,0.2]`. */
export function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(",")}]`;
}
