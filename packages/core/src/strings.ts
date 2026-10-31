/** Trims each item and drops empties and case-insensitive repeats, keeping the first spelling. */
export function uniqueStrings(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    const key = trimmed.toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(trimmed);
    }
  }
  return out;
}
