import { describe, expect, it } from "vitest";
import { parsePersona, personaV1 } from "../src/persona";

describe("personaV1 schema", () => {
  it("parses valid persona", () => {
    const data = {
      facts: ["likes cats"],
      name: "TestBot",
      phrases: ["lol"],
      quotes: ["hello", "hi there"],
      stats: { medianLen: 10, messageCount: 100, p90Len: 20 },
      styleGuide: "Be casual",
      version: 1,
    };
    const result = personaV1.parse(data);
    expect(result.name).toBe("TestBot");
    expect(result.version).toBe(1);
    expect(result.quotes.length).toBe(2);
  });

  it("allows optional languageHint", () => {
    const data = {
      facts: [],
      languageHint: "en-US",
      name: "TestBot",
      phrases: [],
      quotes: [],
      stats: { medianLen: 10, p90Len: 20 },
      styleGuide: "Be casual",
      version: 1,
    };
    const result = personaV1.parse(data);
    expect(result.languageHint).toBe("en-US");
  });

  it("allows optional messageCount", () => {
    const data = {
      facts: [],
      name: "TestBot",
      phrases: [],
      quotes: [],
      stats: { medianLen: 10, p90Len: 20 },
      styleGuide: "Be casual",
      version: 1,
    };
    const result = personaV1.parse(data);
    expect(result.stats.messageCount).toBeUndefined();
  });
});

describe("parsePersona", () => {
  it("parses direct personaV1 object", () => {
    const data = {
      facts: [],
      name: "Bot",
      phrases: [],
      quotes: ["hi"],
      stats: { medianLen: 5, p90Len: 10 },
      styleGuide: "Style",
      version: 1,
    };
    const result = parsePersona(data);
    expect(result.name).toBe("Bot");
  });

  it("parses nested profile object", () => {
    const data = {
      profile: {
        facts: ["from spain"],
        languageHint: "es",
        name: "NestedBot",
        phrases: ["gracias"],
        quotes: ["hola"],
        stats: { medianLen: 12, p90Len: 25 },
        styleGuide: "Be nice",
      },
    };
    const result = parsePersona(data);
    expect(result.version).toBe(1);
    expect(result.name).toBe("NestedBot");
    expect(result.languageHint).toBe("es");
    expect(result.quotes).toEqual(["hola"]);
  });

  it("provides defaults for nested profile", () => {
    const data = {
      profile: {
        name: "Bot",
      },
    };
    const result = parsePersona(data);
    expect(result.styleGuide).toBe("");
    expect(result.stats).toEqual({ medianLen: 0, p90Len: 0 });
    expect(result.quotes).toEqual([]);
    expect(result.phrases).toEqual([]);
    expect(result.facts).toEqual([]);
  });

  it("uses default name if missing in nested profile", () => {
    const data = {
      profile: {},
    };
    const result = parsePersona(data);
    expect(result.name).toBe("Bot");
  });
});
