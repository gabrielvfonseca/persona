import { z } from "zod";

const baseFields = {
  PERSONA_CONSENT: z
    .string()
    .refine((v) => v === "true", { message: 'PERSONA_CONSENT must be "true"' }),
  PERSONA_NAME: z.string().min(1),
  PERSONA_MODEL: z.string().min(1),
  PERSONA_FILE: z.string().default("data/persona.json"),
  OPENROUTER_API_KEY: z.string().min(1),
  ADMIN_NUMBERS: z.string().optional(),
  MAX_PER_10MIN: z.coerce.number().int().min(1).max(100).default(5),
  STICKER_MODEL: z.string().optional(),
  /** Embedding model for semantic recall. Unset means keyword recall only. */
  EMBEDDING_MODEL: z.string().optional(),
  /** Past messages added to each prompt. 0 turns recall off. */
  RECALL_LIMIT: z.coerce.number().int().min(0).max(20).default(4),
  /** Enable continuous learning. Set to "true" to activate. */
  LEARNING_ENABLED: z
    .string()
    .optional()
    .refine((v) => v === undefined || v === "true", {
      message: 'LEARNING_ENABLED must be "true"',
    }),
  /** How many outcomes before weights start moving. */
  LEARNING_WARMUP: z.coerce.number().int().min(0).default(5),
  /** Step size for weight nudges. */
  LEARNING_STEP: z.coerce.number().min(0.1).default(0.5),
  /** Run distillation every N outcomes. */
  LEARNING_DISTILL_EVERY: z.coerce.number().int().min(1).default(20),
  /** Max facts/phrases per patch. */
  LEARNING_MAX_PATCH: z.coerce.number().int().min(1).default(5),
};

export const linkedDeviceSchema = z.object({
  ...baseFields,
  AUTH_DIR: z.string().default(".auth"),
});

export const cloudApiSchema = z.object({
  ...baseFields,
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_APP_SECRET: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  ADMIN_KEY: z.string().min(1),
});

export type LinkedDeviceConfig = z.infer<typeof linkedDeviceSchema>;
export type CloudApiConfig = z.infer<typeof cloudApiSchema>;

/** Splits a comma-separated env value into trimmed, non-empty items. */
export function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parses env for one transport. Reports every problem at once. */
export function parseConfig(
  env: Record<string, string | undefined>,
  mode: "linked-device",
): LinkedDeviceConfig;
export function parseConfig(
  env: Record<string, string | undefined>,
  mode: "cloud-api",
): CloudApiConfig;
export function parseConfig(
  env: Record<string, string | undefined>,
  mode: "linked-device" | "cloud-api",
): LinkedDeviceConfig | CloudApiConfig {
  const schema = mode === "cloud-api" ? cloudApiSchema : linkedDeviceSchema;
  const result = schema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  ${i.path.join(".")}: ${i.message}`,
    );
    throw new Error(`Invalid ${mode} config:\n${lines.join("\n")}`);
  }
  return result.data;
}