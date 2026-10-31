import { describe, expect, it, vi } from "vitest";

const MODEL_WIDTH_HINT = /other-model produces 768 dimensions, expected 384/u;

const embedMock = vi.fn();
vi.mock("ggml-node", () => ({
  createGgmlNode: () => ({ embed: embedMock, unload: () => Promise.resolve() }),
}));

const { createLocalEmbedder, EMBEDDING_DIMENSION } = await import(
  "../src/embedder"
);

describe("createLocalEmbedder", () => {
  it("returns the model's vectors in input order", async () => {
    const v = new Array<number>(EMBEDDING_DIMENSION).fill(0.1);
    embedMock.mockResolvedValueOnce({
      dimensions: EMBEDDING_DIMENSION,
      embeddings: [v, v],
    });
    const out = await createLocalEmbedder().embed(["a", "b"]);
    expect(out).toHaveLength(2);
    expect(embedMock).toHaveBeenLastCalledWith({ input: ["a", "b"] });
  });

  it("refuses a model whose vectors are not the column width", async () => {
    embedMock.mockResolvedValueOnce({
      dimensions: 768,
      embeddings: [new Array(768).fill(0)],
    });
    await expect(
      createLocalEmbedder({ model: "other-model" }).embed(["a"])
    ).rejects.toThrow(MODEL_WIDTH_HINT);
  });

  it("names the default model and skips the model for empty input", async () => {
    expect(createLocalEmbedder().model).toBe("bge-small-en-v1.5");
    embedMock.mockClear();
    expect(await createLocalEmbedder().embed([])).toEqual([]);
    expect(embedMock).not.toHaveBeenCalled();
  });
});
