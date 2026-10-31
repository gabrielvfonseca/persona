import { readFileSync } from "node:fs";
import { type Persona, parsePersona } from "@persona/schemas";

/** Reads and validates a persona JSON file from disk (Node or Bun). */
export function loadPersona(path: string): Persona {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `Cannot read persona file ${path}. Copy data/persona.example.json and edit it to create one.`,
      { cause: err }
    );
  }
  return parsePersona(raw);
}
