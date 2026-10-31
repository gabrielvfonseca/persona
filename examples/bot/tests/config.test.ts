import { describe, expect, it } from "vitest";
import { csv, parseConfig } from "../src/config";

const PATTERN_1 = /PERSONA_CONSENT/u;
const PATTERN_2 = /DATABASE_URL/u;
const PATTERN_3 = /DATABASE_URL/u;

const base = {
  DATABASE_URL: "postgres://persona:persona@postgres:5432/persona",
  PERSONA_CONSENT: "true",
  PERSONA_MODEL: "qwen2.5-0.5b",
  PERSONA_NAME: "Ana",
};

describe("parseConfig", () => {
  it("applies defaults", () => {
    const cfg = parseConfig(base);
    expect(cfg.PERSONA_FILE).toBe("data/persona.json");
    expect(cfg.AUTH_DIR).toBe(".auth");
    expect(cfg.MAX_PER_10MIN).toBe(5);
  });

  it('requires consent to be exactly "true"', () => {
    expect(() => parseConfig({ ...base, PERSONA_CONSENT: "yes" })).toThrow(
      PATTERN_1
    );
  });
});

describe("parseConfig database", () => {
  it("requires DATABASE_URL", () => {
    const { DATABASE_URL: _unused, ...withoutUrl } = base;
    expect(() => parseConfig(withoutUrl)).toThrow(PATTERN_2);
  });

  it("rejects a value that is not a URL", () => {
    expect(() => parseConfig({ ...base, DATABASE_URL: "not a url" })).toThrow(
      PATTERN_3
    );
  });

  it("accepts a Postgres URL", () => {
    expect(parseConfig(base).DATABASE_URL).toBe(base.DATABASE_URL);
  });
});

const db = { DATABASE_URL: "postgres://persona:persona@postgres:5432/persona" };

describe("parseConfig embeddings", () => {
  it("defaults to the bge-small-en-v1.5 embedding model", () => {
    const cfg = parseConfig({ ...base, ...db });
    expect(cfg.EMBEDDING_MODEL).toBe("bge-small-en-v1.5");
  });

  it("accepts another embedding model id", () => {
    const cfg = parseConfig({
      ...base,
      ...db,
      EMBEDDING_MODEL: "custom-embed",
    });
    expect(cfg.EMBEDDING_MODEL).toBe("custom-embed");
  });
});

describe("csv", () => {
  it("trims and drops empty items", () => {
    expect(csv(" 1 , ,2,")).toEqual(["1", "2"]);
    expect(csv(undefined)).toEqual([]);
  });
});
