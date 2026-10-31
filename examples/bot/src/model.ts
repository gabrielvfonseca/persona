import type { ModelId, ModelSource } from "ggml-node";

const PATTERN_1 = /\.gguf$/iu;
const PATTERN_2 = /^[./~]/u;

/** Registry models that ggml-node can download and run by id. */
export const REGISTRY_MODELS = [
  "qwen2.5-0.5b",
  "qwen2.5-1.5b",
  "smollm2-360m",
] as const;

export type RegistryModel = (typeof REGISTRY_MODELS)[number];

// Fails to compile if ggml-node adds or removes a registry model. The embedding
// model is listed so the check is exhaustive, but it is not a valid PERSONA_MODEL.
export const registryIsExhaustive: Record<ModelId, true> = {
  "bge-small-en-v1.5": true,
  "qwen2.5-0.5b": true,
  "qwen2.5-1.5b": true,
  "smollm2-360m": true,
};

export const DEFAULT_MODEL: RegistryModel = "qwen2.5-0.5b";

export function isRegistryModel(value: string): value is RegistryModel {
  return (REGISTRY_MODELS as readonly string[]).includes(value);
}

/** A value that names a GGUF file on disk rather than a registry id. */
export function isGgufPath(value: string): boolean {
  return PATTERN_1.test(value) || PATTERN_2.test(value);
}

/**
 * Turns the PERSONA_MODEL value into a ggml-node model source. Accepts a
 * registry id, or a path to a GGUF file (for example a fine-tuned model).
 */
export function toModelSource(value: string): ModelSource {
  if (isRegistryModel(value)) {
    return value;
  }
  if (isGgufPath(value)) {
    return { path: value };
  }
  throw new Error(
    `Unknown model "${value}". Use one of ${REGISTRY_MODELS.join(", ")} or a path to a .gguf file.`
  );
}
