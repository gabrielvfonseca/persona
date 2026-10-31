import { createHash } from "node:crypto";
import { parseExport, parseExportDateAuto, segment } from "../ingest";

const PATTERN_1 = /\s+/gu;

/** One message from a group export, before it is indexed. */
export interface GroupRecord {
  group: string;
  /** Stable id: a hash of group, time, sender and text. Re-importing skips duplicates. */
  id: string;
  sender: string;
  text: string;
  /** Epoch milliseconds, or 0 when the export timestamp could not be parsed. */
  ts: number;
  /** Conversation window from `segment` (a 30-minute gap starts a new one). */
  windowId: number;
}

const MEDIA = "<Media omitted>";
const LINK = /https?:\/\//iu;

/** Parses a WhatsApp export into group records, skipping media, links and empty text. */
export function importGroupExport(raw: string, group: string): GroupRecord[] {
  return segment(parseExport(raw))
    .filter((m) => {
      const text = m.text.trim();
      return text.length >= 2 && !text.includes(MEDIA) && !LINK.test(text);
    })
    .map((m) => {
      const text = m.text.replace(PATTERN_1, " ").trim();
      const ts = parseTimestamp(m.ts);
      return {
        group,
        id: recordId(group, ts, m.sender, text),
        sender: m.sender,
        text,
        ts,
        windowId: m.windowId ?? 0,
      };
    });
}

export function recordId(
  group: string,
  ts: number,
  sender: string,
  text: string
): string {
  return createHash("sha1")
    .update(`${group}\u0000${ts}\u0000${sender}\u0000${text}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Epoch milliseconds for an export timestamp, or 0 when it cannot be read.
 * Handles both day-first and month-first exports (see parseExportDateAuto).
 */
export function parseTimestamp(raw: string): number {
  const ms = parseExportDateAuto(raw);
  return Number.isNaN(ms) ? 0 : ms;
}
