import { describe, expect, it } from "vitest";
import {
  firstSentence,
  noEcho,
  notEmpty,
  stripSpeakerPrefix,
} from "../src/guards";
import { buildSystemPrompt } from "../src/prompt";

describe("buildSystemPrompt", () => {
  const persona = {
    facts: ["likes coffee"],
    name: "TestBot",
    phrases: ["lol", "brb"],
    quotes: ["hello there", "how can I help?"],
    stats: { medianLen: 10, p90Len: 20 },
    styleGuide: "Be casual and friendly",
    version: 1 as const,
  };

  it("builds basic prompt", () => {
    const prompt = buildSystemPrompt(persona);
    expect(prompt).toContain("You are TestBot.");
    expect(prompt).toContain("Be casual and friendly");
    expect(prompt).toContain("Reply in at most 15 words.");
  });

  it("includes language hint if provided", () => {
    const p = { ...persona, languageHint: "en-US" };
    const prompt = buildSystemPrompt(p);
    expect(prompt).toContain("Language: en-US");
  });

  it("respects maxWords option", () => {
    const prompt = buildSystemPrompt(persona, { maxWords: 10 });
    expect(prompt).toContain("Reply in at most 10 words.");
  });

  it("admits being bot by default", () => {
    const prompt = buildSystemPrompt(persona);
    expect(prompt).toContain("If asked, admit you are an AI bot.");
  });

  it("can skip admitting being bot", () => {
    const prompt = buildSystemPrompt(persona, { admitBeingABot: false });
    expect(prompt).not.toContain("If asked, admit you are an AI bot.");
  });

  it("includes examples", () => {
    const prompt = buildSystemPrompt(persona);
    expect(prompt).toContain("Examples:");
    expect(prompt).toContain("- hello there");
  });

  it("limits examples count", () => {
    const p = {
      ...persona,
      quotes: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
    };
    const prompt = buildSystemPrompt(p, { maxExamples: 3 });
    const exampleLines = prompt
      .split("\n")
      .filter((l) => l.startsWith("- ") && p.quotes.includes(l.slice(2)));
    expect(exampleLines.length).toBeLessThanOrEqual(3);
  });

  it("filters examples by length", () => {
    const p = {
      ...persona,
      quotes: ["short", "a".repeat(100)],
    };
    const prompt = buildSystemPrompt(p, { maxExampleChars: 80 });
    expect(prompt).toContain("- short");
    expect(prompt).not.toContain("a".repeat(100));
  });

  it("filters out examples with system line patterns", () => {
    const p = {
      ...persona,
      quotes: ["hello", "end-to-end encryption info"],
    };
    const prompt = buildSystemPrompt(p);
    expect(prompt).not.toContain("end-to-end");
  });

  it("includes phrases if present", () => {
    const prompt = buildSystemPrompt(persona);
    expect(prompt).toContain("Phrases:");
    expect(prompt).toContain("- lol");
  });

  it("includes facts if present", () => {
    const prompt = buildSystemPrompt(persona);
    expect(prompt).toContain("Facts:");
    expect(prompt).toContain("- likes coffee");
  });

  it("omits phrases section if empty", () => {
    const p = { ...persona, phrases: [] };
    const prompt = buildSystemPrompt(p);
    expect(prompt).not.toContain("Phrases:");
  });

  it("omits facts section if empty", () => {
    const p = { ...persona, facts: [] };
    const prompt = buildSystemPrompt(p);
    expect(prompt).not.toContain("Facts:");
  });

  it("includes extra rules", () => {
    const prompt = buildSystemPrompt(persona, {
      extraRules: ["Be respectful", "No spam"],
    });
    expect(prompt).toContain("Be respectful");
    expect(prompt).toContain("No spam");
  });
});

describe("Reply guards and transforms", () => {
  it("stripSpeakerPrefix removes speaker prefix", () => {
    expect(stripSpeakerPrefix("Alice: hello")).toBe("hello");
    expect(stripSpeakerPrefix("Bot: hi there")).toBe("hi there");
  });

  it("stripSpeakerPrefix keeps text without prefix", () => {
    expect(stripSpeakerPrefix("hello world")).toBe("hello world");
  });

  it("firstSentence extracts first sentence", () => {
    expect(firstSentence("Hello there. How are you?")).toBe("Hello there.");
    expect(firstSentence("Hi! Nice day.")).toBe("Hi!");
    expect(firstSentence("What is up?")).toBe("What is up?");
  });

  it("firstSentence returns full text if no punctuation", () => {
    expect(firstSentence("hello world")).toBe("hello world");
  });

  it("noEcho returns true if no echo", () => {
    const result = noEcho("completely different response", {
      examples: ["hello there"],
    });
    expect(result).toBe(true);
  });

  it("noEcho returns false if echoes example", () => {
    const result = noEcho("hello there general kenobi how are you", {
      examples: ["hello there general kenobi"],
    });
    expect(result).toBe(false);
  });

  it("noEcho ignores short examples", () => {
    const result = noEcho("hi there", {
      examples: ["hi"],
    });
    expect(result).toBe(true);
  });

  it("notEmpty returns true for non-empty", () => {
    expect(notEmpty("hello", { examples: [] })).toBe(true);
  });

  it("notEmpty returns false for empty", () => {
    expect(notEmpty("", { examples: [] })).toBe(false);
    expect(notEmpty("   ", { examples: [] })).toBe(false);
  });
});
