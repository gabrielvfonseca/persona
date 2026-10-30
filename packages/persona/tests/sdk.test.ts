import { parsePersona } from "@persona/schemas";
import { describe, expect, it } from "vitest";
import {
  firstSentence,
  noEcho,
  notEmpty,
  stripSpeakerPrefix,
} from "../src/guards";
import { buildSystemPrompt } from "../src/prompt";

describe("parsePersona", () => {
  it("parses v1 schema", () => {
    const p = parsePersona({
      version: 1,
      name: "Test",
      styleGuide: "casual",
      quotes: ["hi"],
      phrases: ["bye"],
      facts: ["likes cats"],
      stats: { medianLen: 10, p90Len: 20 },
    });
    expect(p.name).toBe("Test");
  });
  it("parses legacy profile shape", () => {
    const p = parsePersona({
      profile: {
        name: "Legacy",
        styleGuide: "legacy style",
        quotes: ["legacy quote"],
        stats: { medianLen: 5, p90Len: 10 },
      },
    });
    expect(p.name).toBe("Legacy");
    expect(p.quotes).toEqual(["legacy quote"]);
    expect(p.phrases).toEqual([]);
  });
});

describe("buildSystemPrompt", () => {
  it("includes name and examples", () => {
    const prompt = buildSystemPrompt({
      version: 1,
      name: "TestBot",
      styleGuide: "be brief",
      quotes: ["hello there", "good morning"],
      phrases: [],
      facts: [],
      stats: { medianLen: 10, p90Len: 20 },
    });
    expect(prompt).toContain("TestBot");
    expect(prompt).toContain("be brief");
  });
  it("filters system lines", () => {
    const prompt = buildSystemPrompt({
      version: 1,
      name: "TestBot",
      styleGuide: "x",
      quotes: ["end-to-end encrypted message", "real quote"],
      phrases: [],
      facts: [],
      stats: { medianLen: 10, p90Len: 20 },
    });
    expect(prompt).not.toContain("end-to-end");
    expect(prompt).toContain("real quote");
  });
});

describe("guards", () => {
  it("stripSpeakerPrefix removes prefix", () => {
    expect(stripSpeakerPrefix("Alice: hello")).toBe("hello");
  });
  it("firstSentence keeps first sentence", () => {
    expect(firstSentence("hello. how are you?")).toBe("hello.");
  });
  it("noEcho blocks long example copies", () => {
    const longEx = "this is a very long example text that exceeds twenty chars";
    expect(
      noEcho("this is a very long example text that exceeds twenty chars end", {
        examples: [longEx],
      }),
    ).toBe(false);
    expect(noEcho("original reply", { examples: [longEx] })).toBe(true);
  });
  it("notEmpty rejects blank", () => {
    expect(notEmpty("", { examples: [] })).toBe(false);
    expect(notEmpty("   ", { examples: [] })).toBe(false);
    expect(notEmpty("hello", { examples: [] })).toBe(true);
  });
});
