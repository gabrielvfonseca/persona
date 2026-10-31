import { z } from "zod";

const baseFields = {
  ADMIN_NUMBERS: z.string().optional(),
  /** Bearer token for the ingest API. Required when API_PORT is set. */
  API_KEY: z.string().min(16).optional(),
  /** Port for the ingest API. Unset means no API is served. */
  API_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  /** Postgres connection string (pgvector). Holds history, dedupe, rate limits, pause, learning and memory. */
  DATABASE_URL: z.string().url(),
  /** ggml-node embedding model, run in-process. Must produce 384-dimension vectors. */
  EMBEDDING_MODEL: z.string().min(1).default("bge-small-en-v1.5"),
  /** Run distillation every N outcomes. */
  LEARNING_DISTILL_EVERY: z.coerce.number().int().min(1).default(20),
  /** Enable continuous learning. Set to "true" to activate. */
  LEARNING_ENABLED: z
    .string()
    .optional()
    .refine((v) => v === undefined || v === "true", {
      message: 'LEARNING_ENABLED must be "true"',
    }),
  /** Max facts/phrases per patch. */
  LEARNING_MAX_PATCH: z.coerce.number().int().min(1).default(5),
  /** Step size for weight nudges. */
  LEARNING_STEP: z.coerce.number().min(0.1).default(0.5),
  /** How many outcomes before weights start moving. */
  LEARNING_WARMUP: z.coerce.number().int().min(0).default(5),
  MAX_PER_10MIN: z.coerce.number().int().min(1).max(100).default(5),
  /** Most memory nodes kept searchable. Oldest are evicted past this. */
  MEMORY_MAX_NODES: z.coerce
    .number()
    .int()
    .min(100)
    .max(1_000_000)
    .default(50_000),
  /** Context window for the local model, in tokens. */
  MODEL_CONTEXT: z.coerce.number().int().min(512).max(32_768).default(4096),
  PERSONA_CONSENT: z
    .string()
    .refine((v) => v === "true", { message: 'PERSONA_CONSENT must be "true"' }),
  PERSONA_FILE: z.string().default("data/persona.json"),
  /** Registry id (qwen2.5-0.5b, qwen2.5-1.5b, smollm2-360m) or a .gguf path. Unset uses the active fine-tuned model, else qwen2.5-0.5b. */
  PERSONA_MODEL: z.string().optional(),
  PERSONA_NAME: z.string().min(1),
  /** Past messages added to each prompt. 0 turns recall off. */
  RECALL_LIMIT: z.coerce.number().int().min(0).max(20).default(4),
};

export const configSchema = z.object({
  ...baseFields,
  AUTH_DIR: z.string().default(".auth"),
});

export type BotConfig = z.infer<typeof configSchema>;

/** Splits a comma-separated env value into trimmed, non-empty items. */
export function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parses the bot's environment. Reports every problem at once. */
export function parseConfig(
  env: Record<string, string | undefined>
): BotConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  ${i.path.join(".")}: ${i.message}`
    );
    throw new Error(`Invalid bot config:\n${lines.join("\n")}`);
  }
  return result.data;
}

/** Paths only, with the same defaults as the schema. For CLIs that need no model or transport. */
export function pathsFromEnv(env: Record<string, string | undefined>): {
  personaFile: string;
} {
  return {
    personaFile: env.PERSONA_FILE || "data/persona.json",
  };
}
