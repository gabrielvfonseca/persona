import type { ReplyGenerator, Turn } from "@persona/core";
import { createGgmlNode, type GgmlNode } from "ggml-node";
import { toModelSource } from "./model";

export interface LocalModelOptions {
  /** Context window in tokens. Smaller uses less memory. */
  contextSize?: number | undefined;
  maxTokens?: number | undefined;
  /** Registry id or GGUF path. */
  model: string;
  temperature?: number | undefined;
}

export interface LocalModel {
  generator: ReplyGenerator;
  /** Frees the model's memory. The next reply reloads it. */
  unload: () => Promise<void>;
}

/**
 * Replies from a model that runs inside this Node process through ggml-node.
 * Loads lazily on the first reply. Node only: never import this from code that
 * a Worker bundles.
 */
export function createLocalModel(opts: LocalModelOptions): LocalModel {
  const ai: GgmlNode = createGgmlNode({
    contextSize: opts.contextSize,
    model: toModelSource(opts.model),
  });
  return {
    generator: {
      async generate(system: string, turns: Turn[]): Promise<string> {
        const { text } = await ai.generate({
          maxTokens: opts.maxTokens ?? 60,
          messages: [
            ...(system ? [{ content: system, role: "system" as const }] : []),
            ...turns,
          ],
          temperature: opts.temperature ?? 0.2,
        });
        return text;
      },
    },
    unload: () => ai.unload(),
  };
}
