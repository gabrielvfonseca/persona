import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type {
  Embedder,
  ImageDescriber,
  ReplyGenerator,
  Turn,
} from "@persona/core";
import { generateText } from "ai";
import { z } from "zod";

export interface OpenRouterOptions {
  apiKey: string;
  model: string;
}

/** Text replies through OpenRouter. Short output, low temperature. */
export function openRouterGenerator(opts: OpenRouterOptions): ReplyGenerator {
  const provider = createOpenRouter({ apiKey: opts.apiKey });
  return {
    async generate(system: string, messages: Turn[]): Promise<string> {
      const { text } = await generateText({
        maxOutputTokens: 60,
        messages,
        model: provider.chat(opts.model),
        system,
        temperature: 0.2,
      });
      return text ?? "";
    },
  };
}

/** One-line image descriptions through an OpenRouter vision model. */
export function openRouterDescriber(opts: OpenRouterOptions): ImageDescriber {
  const provider = createOpenRouter({ apiKey: opts.apiKey });
  return {
    async describe(data: Uint8Array, mime: string): Promise<string> {
      const { text } = await generateText({
        maxOutputTokens: 60,
        messages: [
          {
            content: [
              { text: "Describe this image in a few words.", type: "text" },
              { image: Buffer.from(data), mediaType: mime, type: "image" },
            ],
            role: "user",
          },
        ],
        model: provider.chat(opts.model),
      });
      return (text ?? "").trim();
    },
  };
}

const embeddingResponse = z.object({
  data: z.array(
    z.object({ index: z.number().int(), embedding: z.array(z.number()) }),
  ),
});

export interface OpenRouterEmbedderOptions extends OpenRouterOptions {
  fetch?: typeof fetch | undefined;
}

/** Embeddings through OpenRouter's OpenAI-compatible endpoint. */
export function openRouterEmbedder(opts: OpenRouterEmbedderOptions): Embedder {
  const doFetch = opts.fetch ?? fetch;
  return {
    async embed(texts: readonly string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const res = await doFetch("https://openrouter.ai/api/v1/embeddings", {
        body: JSON.stringify({ input: texts, model: opts.model }),
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
      if (!res.ok) throw new Error(`Embeddings request failed: ${res.status}`);
      const parsed = embeddingResponse.parse(await res.json());
      const sorted = [...parsed.data].sort((a, b) => a.index - b.index);
      return sorted.map((d) => d.embedding);
    },
  };
}
