/** Maps a ggml-node registry id to the full-precision Hugging Face repo to train from. */
export const TRAINING_BASES: Record<"qwen2.5-0.5b" | "qwen2.5-1.5b", string> = {
  "qwen2.5-0.5b": "Qwen/Qwen2.5-0.5B-Instruct",
  "qwen2.5-1.5b": "Qwen/Qwen2.5-1.5B-Instruct",
};

export function trainingBaseFor(model: string): string {
  if (model === "qwen2.5-0.5b" || model === "qwen2.5-1.5b") {
    return TRAINING_BASES[model];
  }
  throw new Error(
    `Training supports qwen2.5-0.5b and qwen2.5-1.5b, not "${model}".`
  );
}
