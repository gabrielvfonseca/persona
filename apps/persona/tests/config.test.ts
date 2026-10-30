import { describe, expect, it } from "vitest";
import { csv, parseConfig } from "../src/config";

const base = {
  PERSONA_CONSENT: "true",
  PERSONA_NAME: "Ana",
  PERSONA_MODEL: "openai/gpt-4o-mini",
  OPENROUTER_API_KEY: "test-key",
};

describe("parseConfig", () => {
  it("applies defaults for the linked device", () => {
    const cfg = parseConfig(base, "linked-device");
    expect(cfg.PERSONA_FILE).toBe("data/persona.json");
    expect(cfg.AUTH_DIR).toBe(".auth");
    expect(cfg.MAX_PER_10MIN).toBe(5);
  });

  it('requires consent to be exactly "true"', () => {
    expect(() =>
      parseConfig({ ...base, PERSONA_CONSENT: "yes" }, "linked-device"),
    ).toThrow(/PERSONA_CONSENT/);
  });

  it("reports every missing Cloud API field at once", () => {
    try {
      parseConfig(base, "cloud-api");
      expect.unreachable();
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("WHATSAPP_ACCESS_TOKEN");
      expect(msg).toContain("WHATSAPP_APP_SECRET");
      expect(msg).toContain("ADMIN_KEY");
    }
  });
});

describe("csv", () => {
  it("trims and drops empty items", () => {
    expect(csv(" 1 , ,2,")).toEqual(["1", "2"]);
    expect(csv(undefined)).toEqual([]);
  });
});
