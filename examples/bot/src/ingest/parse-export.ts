import { parseExportDateAuto } from "./parse-date";
export interface Message {
  sender: string;
  text: string;
  ts: string;
  windowId?: number | undefined;
}

const MEDIA_OMITTED = "<Media omitted>";
const CRLF = /\r\n/gu;
const ENCRYPTION_NOTICE = "end-to-end encrypted";
const DATE_START = /^[0-9]{1,2}[/.-]/u;

// iOS style: [DD/MM/YYYY, HH:MM:SS] Name: message
const BRACKETS = /^\[(?<ts>.+?)\] (?<sender>.+?): (?<text>.*)$/u;
// Android style: DD/MM/YYYY, HH:MM - Name: message
const DASH =
  /^(?<date>[0-9]{1,2}[/.-][0-9]{1,2}[/.-][0-9]{2,4}),?\s+(?<time>[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?(?:\s*[APap][Mm])?)\s+-\s+(?<sender>.+?):\s+(?<text>.*)$/u;
const DASH_NO_SENDER =
  /^[0-9]{1,2}[/.-][0-9]{1,2}[/.-][0-9]{2,4},?\s+[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?(?:\s*[APap][Mm])?\s+-\s+.*$/u;

function normalizeText(text: string): string {
  return text.includes(MEDIA_OMITTED) ? MEDIA_OMITTED : text;
}

type LineKind =
  | { kind: "message"; message: Message }
  | { kind: "continuation" }
  | { kind: "skip" };

/** What one export line is: a new message, a continuation of the last one, or noise. */
function classify(line: string): LineKind {
  if (!line.trim()) {
    return { kind: "skip" };
  }

  const bracket = BRACKETS.exec(line)?.groups;
  if (bracket) {
    return {
      kind: "message",
      message: {
        sender: bracket.sender ?? "",
        text: normalizeText(bracket.text ?? ""),
        ts: bracket.ts ?? "",
      },
    };
  }

  const dash = DASH.exec(line)?.groups;
  if (dash) {
    return {
      kind: "message",
      message: {
        sender: dash.sender ?? "",
        text: normalizeText(dash.text ?? ""),
        ts: `${dash.date ?? ""} ${dash.time ?? ""}`,
      },
    };
  }

  if (DASH_NO_SENDER.test(line)) {
    return { kind: "skip" };
  }
  return { kind: "continuation" };
}

export function parseExport(raw: string): Message[] {
  const out: Message[] = [];
  for (const line of raw.replace(CRLF, "\n").split("\n")) {
    const parsed = classify(line);
    const last = out.at(-1);
    if (parsed.kind === "message") {
      out.push(parsed.message);
    } else if (
      parsed.kind === "continuation" &&
      last &&
      !DATE_START.test(line) &&
      !line.includes(ENCRYPTION_NOTICE)
    ) {
      // Only a continuation with a message to attach to, and not a date line, is kept.
      last.text += `\n${line}`;
    }
  }
  return out;
}

export function segment(msgs: Message[], gapMinutes = 30): Message[] {
  const gapMs = gapMinutes * 60 * 1000;
  let windowId = 0;
  let prev: number | null = null;
  for (const m of msgs) {
    const ts = parseExportDateAuto(m.ts);
    // An unreadable timestamp joins the current window rather than starting a new one.
    if (!Number.isNaN(ts)) {
      if (prev !== null && ts - prev > gapMs) {
        windowId += 1;
      }
      prev = ts;
    }
    m.windowId = windowId;
  }
  return msgs;
}
