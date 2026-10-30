import { describe, expect, it } from "vitest";
import { parseExportDate } from "../src/parse-date";

describe("parseExportDate", () => {
  it("parses DD/MM/YYYY", () => {
    const d = parseExportDate("29/10/2026 18:50", "dmy");
    expect(d.getDate()).toBe(29);
    expect(d.getMonth()).toBe(9);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getHours()).toBe(18);
    expect(d.getMinutes()).toBe(50);
  });
  it("parses MM/DD/YY with AM/PM", () => {
    const d = parseExportDate("10/29/26, 6:50 PM", "mdy");
    expect(d.getDate()).toBe(29);
    expect(d.getMonth()).toBe(9);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getHours()).toBe(18);
  });
});
