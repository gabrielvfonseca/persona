import { describe, expect, it } from "vitest";
import { uniqueStrings } from "../src/strings";

describe("uniqueStrings", () => {
  it("trims, drops empties, and keeps the first spelling of case-insensitive repeats", () => {
    expect(uniqueStrings(["  Oi ", "oi", "", "  ", "Tchau"])).toEqual([
      "Oi",
      "Tchau",
    ]);
  });
});
