import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cloudApiSchema,
  csv,
  linkedDeviceSchema,
  parseConfig,
} from "../../examples/bot/src/config";
import { loadPersona } from "../../examples/bot/src/persona-file";

const personaPath = join(
  import.meta.dirname,
  "../../examples/bot/data/persona.example.json",
);

const linkedEnv = {
  PERSONA_CONSENT: "true",
  PERSONA_NAME: "Ana",
  PERSONA_MODEL: "openai/gpt-4o-mini",
  OPENROUTER_API_KEY: "sk-test",
};

const cloudEnv = {
  ...linkedEnv,
  WHATSAPP_ACCESS_TOKEN: "token",
  WHATSAPP_APP_SECRET: "secret",
  WHATSAPP_PHONE_NUMBER_ID: "PHONE_1",
  WHATSAPP_VERIFY_TOKEN: "verify",
  ADMIN_KEY: "admin-pass",
};

describe("example config", () => {
  it("applies defaults for the linked device", () => {
    const config = parseConfig(linkedEnv, "linked-device");

    expect(config.PERSONA_FILE).toBe("data/persona.json");
    expect(config.AUTH_DIR).toBe(".auth");
    expect(config.MAX_PER_10MIN).toBe(5);
    expect(config.RECALL_LIMIT).toBe(4);
    expect(config.LEARNING_ENABLED).toBeUndefined();
    expect(config.LEARNING_WARMUP).toBe(5);
  });

  it("coerces numeric values from strings", () => {
    const config = parseConfig(
      { ...linkedEnv, MAX_PER_10MIN: "12", RECALL_LIMIT: "0" },
      "linked-device",
    );

    expect(config.MAX_PER_10MIN).toBe(12);
    expect(config.RECALL_LIMIT).toBe(0);
  });

  it("refuses to start without explicit consent", () => {
    expect(() =>
      parseConfig({ ...linkedEnv, PERSONA_CONSENT: "yes" }, "linked-device"),
    ).toThrow(/PERSONA_CONSENT must be "true"/);
  });

  it("reports every problem at once", () => {
    let message = "";
    try {
      parseConfig({}, "linked-device");
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toMatch(/^Invalid linked-device config:/);
    for (const key of [
      "PERSONA_CONSENT",
      "PERSONA_NAME",
      "OPENROUTER_API_KEY",
    ]) {
      expect(message).toContain(key);
    }
  });

  it("requires the Cloud API secrets only in cloud mode", () => {
    expect(() => parseConfig(linkedEnv, "cloud-api")).toThrow(
      /WHATSAPP_ACCESS_TOKEN/,
    );
    expect(parseConfig(cloudEnv, "cloud-api").ADMIN_KEY).toBe("admin-pass");
  });

  it("rejects out-of-range rate limits", () => {
    expect(() =>
      parseConfig({ ...linkedEnv, MAX_PER_10MIN: "0" }, "linked-device"),
    ).toThrow(/MAX_PER_10MIN/);
  });

  it("splits comma lists and drops blanks", () => {
    expect(csv(" 5511 , ,5522,")).toEqual(["5511", "5522"]);
    expect(csv(undefined)).toEqual([]);
  });

  it("keeps the two transport schemas aligned on shared keys", () => {
    const shared = Object.keys(linkedDeviceSchema.shape).filter(
      (k) => k !== "AUTH_DIR",
    );
    for (const key of shared) {
      expect(cloudApiSchema.shape).toHaveProperty(key);
    }
  });
});

describe("example persona file", () => {
  it("loads and validates the shipped example persona", () => {
    const persona = loadPersona(personaPath);

    expect(persona.name).toBe("Ana");
    expect(persona.quotes.length).toBeGreaterThan(0);
  });

  it("explains how to build a missing persona file", () => {
    expect(() => loadPersona("/nonexistent/persona.json")).toThrow(
      /Cannot read persona file/,
    );
  });
});
