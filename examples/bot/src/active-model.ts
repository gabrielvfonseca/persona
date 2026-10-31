import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_MODEL } from "./model";

/** The fine-tuned model the bot uses, written by `bun run train` after it passes evaluation. */
export interface ActiveModel {
  /** Registry id or path of the model that was fine-tuned. */
  baseModel: string;
  /** Absolute path to a GGUF file. */
  path: string;
  promotedAt: string;
  /** Validation loss the model reached. Lower is better. */
  valLoss: number;
}

function isActiveModel(value: unknown): value is ActiveModel {
  return (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    typeof value.path === "string" &&
    "baseModel" in value &&
    typeof value.baseModel === "string" &&
    "valLoss" in value &&
    typeof value.valLoss === "number" &&
    "promotedAt" in value &&
    typeof value.promotedAt === "string"
  );
}

/** Reads the active model record. Returns undefined when none exists or it is malformed. */
export function readActiveModel(file: string): ActiveModel | undefined {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    return isActiveModel(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

/** Writes the record atomically (temp file, then rename). */
export function writeActiveModel(file: string, model: ActiveModel): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(model, null, 2)}\n`);
  renameSync(tmp, file);
}

/** The active model record lives next to the persona file: data/models/active.json. */
export function activeModelFile(personaFile: string): string {
  return join(dirname(personaFile), "models", "active.json");
}

/**
 * The model to load: PERSONA_MODEL when set, else the active fine-tuned model,
 * else the default registry model.
 */
export function resolveModelValue(
  configured: string | undefined,
  activeFile: string
): string {
  if (configured) {
    return configured;
  }
  return readActiveModel(activeFile)?.path ?? DEFAULT_MODEL;
}
