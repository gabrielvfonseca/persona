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

export function parseExport(raw: string): Message[] {
  const out: Message[] = [];
  for (const line of raw.replace(CRLF, "\n").split("\n")) {
    if (!line.trim()) continue;

    const bracket = BRACKETS.exec(line)?.groups;
    if (bracket) {
      out.push({
        sender: bracket.sender ?? "",
        text: normalizeText(bracket.text ?? ""),
        ts: bracket.ts ?? "",
      });
      continue;
    }

    const dash = DASH.exec(line)?.groups;
    if (dash) {
      out.push({
        sender: dash.sender ?? "",
        text: normalizeText(dash.text ?? ""),
        ts: `${dash.date ?? ""} ${dash.time ?? ""}`,
      });
      continue;
    }

    if (DASH_NO_SENDER.test(line)) continue;

    const last = out.at(-1);
    if (!last || DATE_START.test(line) || line.includes(ENCRYPTION_NOTICE))
      continue;
    last.text += `\n${line}`;
  }
  return out;
}

export function segment(msgs: Message[], gapMinutes = 30): Message[] {
  const gapMs = gapMinutes * 60 * 1000;
  let windowId = 0;
  let prev: number | null = null;
  for (const m of msgs) {
    const ts = Date.parse(m.ts);
    if (prev !== null && ts - prev > gapMs) windowId += 1;
    m.windowId = windowId;
    prev = ts;
  }
  return msgs;
}
