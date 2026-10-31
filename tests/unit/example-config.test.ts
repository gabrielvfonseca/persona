import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { csv, parseConfig } from "../../examples/bot/src/config";
import { loadPersona } from "../../examples/bot/src/persona-file";

const PATTERN_1 = /PERSONA_CONSENT must be "true"/u;
const PATTERN_2 = /^Invalid bot config:/u;
const PATTERN_3 = /MAX_PER_10MIN/u;
const PATTERN_4 = /Cannot read persona file/u;

const personaPath = join(
  import.meta.dirname,
  "../../examples/bot/data/persona.example.json"
);

const env = {
  DATABASE_URL: "postgres://persona:persona@localhost:5432/persona",
  PERSONA_CONSENT: "true",
  PERSONA_MODEL: "qwen2.5-0.5b",
  PERSONA_NAME: "Ana",
};

describe("example config", () => {
  it("applies defaults", () => {
    const config = parseConfig(env);

    expect(config.PERSONA_FILE).toBe("data/persona.json");
    expect(config.AUTH_DIR).toBe(".auth");
    expect(config.MAX_PER_10MIN).toBe(5);
    expect(config.RECALL_LIMIT).toBe(4);
    expect(config.LEARNING_ENABLED).toBeUndefined();
    expect(config.LEARNING_WARMUP).toBe(5);
  });

  it("coerces numeric values from strings", () => {
    const config = parseConfig({
      ...env,
      MAX_PER_10MIN: "12",
      RECALL_LIMIT: "0",
    });

    expect(config.MAX_PER_10MIN).toBe(12);
    expect(config.RECALL_LIMIT).toBe(0);
  });

  it("refuses to start without explicit consent", () => {
    expect(() => parseConfig({ ...env, PERSONA_CONSENT: "yes" })).toThrow(
      PATTERN_1
    );
  });

  it("reports every problem at once", () => {
    let message = "";
    try {
      parseConfig({});
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).toMatch(PATTERN_2);
    for (const key of ["PERSONA_CONSENT", "PERSONA_NAME", "DATABASE_URL"]) {
      expect(message).toContain(key);
    }
  });

  it("rejects out-of-range rate limits", () => {
    expect(() => parseConfig({ ...env, MAX_PER_10MIN: "0" })).toThrow(
      PATTERN_3
    );
  });

  it("splits comma lists and drops blanks", () => {
    expect(csv(" 5511 , ,5522,")).toEqual(["5511", "5522"]);
    expect(csv(undefined)).toEqual([]);
  });
});

describe("example persona file", () => {
  it("loads and validates the shipped example persona", () => {
    const persona = loadPersona(personaPath);

    expect(persona.name).toBe("Ana");
    expect(persona.quotes.length).toBeGreaterThan(0);
  });

  it("explains how to build a missing persona file", () => {
    expect(() => loadPersona("/nonexistent/persona.json")).toThrow(PATTERN_4);
  });
});
