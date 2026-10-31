import type { Pool } from "@persona/postgres";
import type { GroupRecord } from "./group-import";

const GROUP_ID = /^[A-Za-z0-9._-]{1,64}$/u;

/** Throws unless the group id is well formed. */
export function assertGroupId(group: string): string {
  if (!GROUP_ID.test(group)) {
    throw new Error(
      "Group ids use letters, digits, dot, dash and underscore (max 64)."
    );
  }
  return group;
}

/** Where group chat records live. Postgres in the container, memory in tests. */
export interface GroupStore {
  /** Stores the records whose ids are new. Returns how many were stored. */
  append: (group: string, records: readonly GroupRecord[]) => Promise<number>;
  listGroups: () => Promise<string[]>;
  /** A group's records, oldest first. */
  read: (group: string) => Promise<GroupRecord[]>;
  /** Deletes a group's records. Returns true when the group had any. */
  remove: (group: string) => Promise<boolean>;
}

interface GroupRow {
  group_name: string;
  id: string;
  sender: string;
  text: string;
  ts: string;
  window_id: number;
}

function toRecord(row: GroupRow): GroupRecord {
  return {
    group: row.group_name,
    id: row.id,
    sender: row.sender,
    text: row.text,
    // bigint columns come back as strings; epoch milliseconds fit in a number.
    ts: Number(row.ts),
    windowId: row.window_id,
  };
}

/** `GroupStore` on the `group_records` table. Duplicate ids are skipped by the database. */
export function pgGroupStore(pool: Pool): GroupStore {
  return {
    async append(group, records) {
      if (records.length === 0) {
        return 0;
      }
      // One round trip for the whole batch, however many records it has.
      const result = await pool.query(
        `INSERT INTO group_records (id, group_name, sender, text, ts, window_id)
         SELECT * FROM unnest(
           $1::text[], $2::text[], $3::text[], $4::text[], $5::bigint[], $6::integer[])
         ON CONFLICT (id) DO NOTHING`,
        [
          records.map((r) => r.id),
          records.map(() => assertGroupId(group)),
          records.map((r) => r.sender),
          records.map((r) => r.text),
          records.map((r) => r.ts),
          records.map((r) => r.windowId),
        ]
      );
      return result.rowCount ?? 0;
    },
    async listGroups() {
      const { rows } = await pool.query<{ group_name: string }>(
        "SELECT DISTINCT group_name FROM group_records ORDER BY group_name"
      );
      return rows.map((row) => row.group_name);
    },

    async read(group) {
      const { rows } = await pool.query<GroupRow>(
        `SELECT id, group_name, sender, text, ts, window_id
           FROM group_records
          WHERE group_name = $1
          ORDER BY ts, id`,
        [assertGroupId(group)]
      );
      return rows.map(toRecord);
    },

    async remove(group) {
      const result = await pool.query(
        "DELETE FROM group_records WHERE group_name = $1",
        [assertGroupId(group)]
      );
      return (result.rowCount ?? 0) > 0;
    },
  };
}

/** A `GroupStore` that keeps everything in memory. Used by tests and simulations. */
export function memoryGroupStore(): GroupStore {
  const groups = new Map<string, Map<string, GroupRecord>>();
  return {
    append(group, records) {
      const stored = groups.get(group) ?? new Map<string, GroupRecord>();
      groups.set(group, stored);
      let added = 0;
      for (const record of records) {
        if (!stored.has(record.id)) {
          stored.set(record.id, record);
          added += 1;
        }
      }
      return Promise.resolve(added);
    },
    listGroups() {
      return Promise.resolve([...groups.keys()].sort());
    },

    read(group) {
      const records = [...(groups.get(group)?.values() ?? [])];
      return Promise.resolve(
        records.sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id))
      );
    },

    remove(group) {
      return Promise.resolve(groups.delete(group));
    },
  };
}
