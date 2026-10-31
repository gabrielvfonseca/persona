import type { WASocket } from "baileys";

export interface GroupSummary {
  id: string;
  participants: number;
  subject: string;
}

export async function listGroups(sock: WASocket): Promise<GroupSummary[]> {
  const groups = await sock.groupFetchAllParticipating();
  return Object.values(groups).map((group) => ({
    id: group.id,
    participants: group.participants.length,
    subject: group.subject,
  }));
}

/** Looks up how many members a group has. Resolves `undefined` when it cannot be read. */
export type GroupSizeLookup = (jid: string) => Promise<number | undefined>;

const GROUP_SIZE_TTL_MS = 10 * 60_000;

/**
 * Caches group member counts so each group's metadata is fetched at most once
 * per TTL, not once per message.
 */
/** The one socket method the lookup reads. */
export interface GroupMetadataSource {
  groupMetadata: (jid: string) => Promise<{ participants: readonly unknown[] }>;
}

export function createGroupSizeLookup(
  sock: GroupMetadataSource,
  opts: { ttlMs?: number | undefined; now?: (() => number) | undefined } = {}
): GroupSizeLookup {
  const ttlMs = opts.ttlMs ?? GROUP_SIZE_TTL_MS;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { size: number; at: number }>();
  return async (jid) => {
    const hit = cache.get(jid);
    if (hit && now() - hit.at < ttlMs) {
      return hit.size;
    }
    try {
      const meta = await sock.groupMetadata(jid);
      const size = meta.participants.length;
      cache.set(jid, { at: now(), size });
      return size;
    } catch {
      /* intentionally empty */
    }
  };
}
