const PATTERN_1 = /\s+/u;
const PATTERN_2 = /,/gu;
const PATTERN_3 = /^(?<g1>\d{1,2})[/.-](?<g2>\d{1,2})[/.-](?<g3>\d{2,4})$/u;
const PATTERN_4 =
  /^(?<g1>\d{1,2}):(?<g2>\d{2})(?::(?<g3>\d{2}))?\s*(?<g4>[APap][Mm])?$/u;
const PATTERN_5 = /[/.,\s-]/u;
const PATTERN_6 = /[/.,\s-]/u;
export function parseExportDate(ts: string, format: "dmy" | "mdy"): Date {
  const clean = ts.trim();
  const parts = clean.split(PATTERN_1);
  const datePartRaw = parts[0] ?? "";
  const datePart = datePartRaw.replace(PATTERN_2, "");
  const timePart = parts.slice(1).join(" ");
  if (!datePart) {
    throw new Error(`Cannot parse date: ${ts}`);
  }

  const dateMatch = datePart.match(PATTERN_3);
  if (!dateMatch) {
    throw new Error(`Cannot parse date part: ${datePart}`);
  }

  const [, dayRaw = "", monthRaw = "", yearRaw = ""] = dateMatch;
  let d = Number.parseInt(dayRaw, 10);
  let m = Number.parseInt(monthRaw, 10);
  let y = Number.parseInt(yearRaw, 10);

  if (format === "mdy") {
    [d, m] = [m, d];
  }

  if (y < 100) {
    y += 2000;
  }

  let h = 0;
  let min = 0;
  let sec = 0;
  let ampm: "am" | "pm" | null = null;

  if (timePart) {
    const timeMatch = timePart.match(PATTERN_4);
    if (timeMatch) {
      h = Number.parseInt(timeMatch[1] ?? "", 10);
      min = Number.parseInt(timeMatch[2] ?? "", 10);
      sec = Number.parseInt(timeMatch[3] ?? "0", 10);
      if (timeMatch[4]) {
        ampm = timeMatch[4].toLowerCase() as "am" | "pm";
      }
    }
  }

  if (ampm === "pm" && h < 12) {
    h += 12;
  }
  if (ampm === "am" && h === 12) {
    h = 0;
  }

  return new Date(y, m - 1, d, h, min, sec);
}

/**
 * Epoch milliseconds for an export timestamp, or NaN when it cannot be read.
 * Picks day-first unless the first number cannot be a day, so "10/29/26" reads
 * as month-first and "29/10/2026" as day-first. Never returns an invalid date.
 */
export function parseExportDateAuto(ts: string): number {
  const first = Number(ts.trim().split(PATTERN_5)[0]);
  const second = Number(ts.trim().split(PATTERN_6)[1]);
  const format = first > 12 || (second <= 12 && first <= 12) ? "dmy" : "mdy";
  try {
    const date = parseExportDate(ts, format);
    return Number.isNaN(date.getTime()) ? Number.NaN : date.getTime();
  } catch {
    return Number.NaN;
  }
}
