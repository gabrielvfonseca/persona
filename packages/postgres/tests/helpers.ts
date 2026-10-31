import { createPool, migrate, type Pool } from "../src/db";

/** Connection string for the test database, or undefined to skip database tests. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

/** A migrated pool with every table emptied. Call from `beforeEach`. */
export async function freshPool(url: string): Promise<Pool> {
  const pool = createPool(url, 4);
  await migrate(pool);
  await pool.query("TRUNCATE pg_edges, pg_nodes, kv");
  return pool;
}
