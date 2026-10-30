import { describe, expect, it } from "vitest";
import { parsePersona, personaV1 } from "../src/persona";

describe("personaV1 schema", () => {
  it("parses valid persona", () => {
    const data = {
      version: 1,
      name: "TestBot",
      styleGuide: "Be casual",
      stats: { medianLen: 10, p90Len: 20, messageCount: 100 },
      quotes: ["hello", "hi there"],
      phrases: ["lol"],
      facts: ["likes cats"],
    };
    const result = personaV1.parse(data);
    expect(result.name).toBe("TestBot");
    expect(result.version).toBe(1);
    expect(result.quotes.length).toBe(2);
  });

  it("allows optional languageHint", () => {
    const data = {
      version: 1,
      name: "TestBot",
      styleGuide: "Be casual",
      languageHint: "en-US",
      stats: { medianLen: 10, p90Len: 20 },
      quotes: [],
      phrases: [],
      facts: [],
    };
    const result = personaV1.parse(data);
    expect(result.languageHint).toBe("en-US");
  });

  it("allows optional messageCount", () => {
    const data = {
      version: 1,
      name: "TestBot",
      styleGuide: "Be casual",
      stats: { medianLen: 10, p90Len: 20 },
      quotes: [],
      phrases: [],
      facts: [],
    };
    const result = personaV1.parse(data);
    expect(result.stats.messageCount).toBeUndefined();
  });
});

describe("parsePersona", () => {
  it("parses direct personaV1 object", () => {
    const data = {
      version: 1,
      name: "Bot",
      styleGuide: "Style",
      stats: { medianLen: 5, p90Len: 10 },
      quotes: ["hi"],
      phrases: [],
      facts: [],
    };
    const result = parsePersona(data);
    expect(result.name).toBe("Bot");
  });

  it("parses nested profile object", () => {
    const data = {
      profile: {
        name: "NestedBot",
        styleGuide: "Be nice",
        languageHint: "es",
        stats: { medianLen: 12, p90Len: 25 },
        quotes: ["hola"],
        phrases: ["gracias"],
        facts: ["from spain"],
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
