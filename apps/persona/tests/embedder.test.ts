import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config";
import { openRouterEmbedder } from "../src/model";

const base = {
  PERSONA_CONSENT: "true",
  PERSONA_NAME: "Ana",
  PERSONA_MODEL: "m",
  OPENROUTER_API_KEY: "k",
};

describe("openRouterEmbedder", () => {
  it("returns vectors in input order", async () => {
    const fetchMock = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      expect(body.input).toEqual(["a", "b"]);
      return new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        }),
      );
    }) as typeof fetch;
    const embedder = openRouterEmbedder({
      apiKey: "k",
      model: "e",
      fetch: fetchMock,
    });
    expect(await embedder.embed(["a", "b"])).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it("throws on a failed request so callers can fall back", async () => {
    const fetchMock = (async () =>
      new Response("no", { status: 500 })) as typeof fetch;
    const embedder = openRouterEmbedder({
      apiKey: "k",
      model: "e",
      fetch: fetchMock,
    });
    await expect(embedder.embed(["a"])).rejects.toThrow("500");
  });
});

describe("config defaults", () => {
  it("turns recall on with 4 turns and leaves embeddings off", () => {
    const cfg = parseConfig(base, "linked-device");
    expect(cfg.RECALL_LIMIT).toBe(4);
    expect(cfg.EMBEDDING_MODEL).toBeUndefined();
  });
});
