import { describe, expect, it } from "vitest";
import { assertEmbeddingWidth, EMBEDDING_DIMENSIONS } from "../src/node-store";

const PATTERN_1 = /3 dimensions; the schema stores 384/u;

describe("assertEmbeddingWidth", () => {
  it("accepts a vector of the stored width", () => {
    const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);
    expect(() => assertEmbeddingWidth(vector)).not.toThrow();
  });

  it("refuses an embedder of another width, naming both sizes", () => {
    expect(() => assertEmbeddingWidth([0.1, 0.2, 0.3])).toThrow(PATTERN_1);
  });
});
