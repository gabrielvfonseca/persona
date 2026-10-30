export function parseExportDate(ts: string, format: "dmy" | "mdy"): Date {
  const clean = ts.trim();
  const parts = clean.split(/\s+/);
  const datePartRaw = parts[0] ?? "";
  const datePart = datePartRaw.replace(/,/g, "");
  const timePart = parts.slice(1).join(" ");
  if (!datePart) throw new Error(`Cannot parse date: ${ts}`);

  const dateMatch = datePart.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!dateMatch) throw new Error(`Cannot parse date part: ${datePart}`);

  const [, dayRaw = "", monthRaw = "", yearRaw = ""] = dateMatch;
  let d = parseInt(dayRaw, 10);
  let m = parseInt(monthRaw, 10);
  let y = parseInt(yearRaw, 10);

  if (format === "mdy") {
    [d, m] = [m, d];
  }

  if (y < 100) y += 2000;

  let h = 0;
  let min = 0;
  let ampm: "am" | "pm" | null = null;

  if (timePart) {
    const timeMatch = timePart.match(
      /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap][Mm])?$/,
    );
    if (timeMatch) {
      h = parseInt(timeMatch[1] ?? "", 10);
      min = parseInt(timeMatch[2] ?? "", 10);
      if (timeMatch[4]) ampm = timeMatch[4].toLowerCase() as "am" | "pm";
    }
  }

  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;

  return new Date(y, m - 1, d, h, min);
}
