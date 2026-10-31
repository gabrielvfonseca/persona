import type pg from "pg";
import type { KVStorage } from "./kv-stores";

/** Sweep expired rows every this many writes, so the table does not grow forever. */
const SWEEP_EVERY_WRITES = 100;

/** `KVStorage` on the `kv` table. TTLs are stored as `expires_at` and enforced on read. */
export class PgKVStorage implements KVStorage {
  private writes = 0;

  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async get(key: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ value: string }>(
      `SELECT value FROM kv
        WHERE key = $1 AND (expires_at IS NULL OR expires_at > now())`,
      [key]
    );
    return rows[0]?.value ?? null;
  }

  async put(
    key: string,
    value: string,
    opts?: { expirationTtl?: number }
  ): Promise<void> {
    const ttl = opts?.expirationTtl ?? null;
    await this.pool.query(
      `INSERT INTO kv (key, value, expires_at)
       VALUES ($1, $2,
         CASE WHEN $3::double precision IS NULL THEN NULL
              ELSE now() + make_interval(secs => $3::double precision) END)
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`,
      [key, value, ttl]
    );
    this.writes += 1;
    if (this.writes % SWEEP_EVERY_WRITES === 0) {
      this.sweepExpired().catch(() => {
        /* intentionally empty */
      });
    }
  }

  async delete(key: string): Promise<void> {
    await this.pool.query("DELETE FROM kv WHERE key = $1", [key]);
  }

  /** Deletes rows whose TTL has passed. Returns how many were removed. */
  async sweepExpired(): Promise<number> {
    const result = await this.pool.query(
      "DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at <= now()"
    );
    return result.rowCount ?? 0;
  }
}
