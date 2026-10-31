import {
  applyPatch,
  defaultLearningState,
  mergeLearningState,
  outcomeSignal,
} from "@persona/learning";
import {
  cosine,
  FixedWindowRateLimiter,
  MemoryDedupeStore,
  reciprocalRankFusion,
  SearchIndex,
  tokenize,
  weightedReciprocalRankFusion,
} from "@persona/memory";
import { mentionsName } from "@persona/policy";
import { parsePersona, personaV1 } from "@persona/schemas";
import { describe, expect, it } from "vitest";
import {
  firstSentence,
  noEcho,
  notEmpty,
  stripSpeakerPrefix,
} from "../../packages/persona/src/guards";
import { buildSystemPrompt } from "../../packages/persona/src/prompt";
import { isWebp } from "../../packages/whatsapp/src/media";
import { extractMessages } from "../../packages/whatsapp/src/payload";
import { isValidSignature } from "../../packages/whatsapp/src/signature";
import { persona, sign } from "../helpers/fakes";

describe("memory: ranking and search", () => {
  it("scores identical vectors 1 and orthogonal vectors 0", () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });

  it("returns 0 for a zero vector instead of NaN", () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });

  it("ranks an id that tops two lists above one that tops only one", () => {
    const fused = reciprocalRankFusion([
      ["a", "b", "c"],
      ["b", "d"],
    ]);

    expect(fused[0]).toBe("b");
  });

  it("lets a heavier list pull the result toward it", () => {
    const fused = weightedReciprocalRankFusion([
      { ids: ["x", "y"], weight: 0.1 },
      { ids: ["y", "x"], weight: 5 },
    ]);

    expect(fused[0]).toBe("y");
  });

  it("tokenizes Unicode letters and digits, lowercased", () => {
    expect(tokenize("Amanhã, às 10h! Ção-ok")).toEqual([
      "amanhã",
      "às",
      "10h",
      "ção",
      "ok",
    ]);
  });

  it("finds documents by BM25 and respects the chat filter", () => {
    const index = new SearchIndex();
    index.add("1", "chat-a", "the bakery opens at seven");
    index.add("2", "chat-b", "the bakery closes at nine");

    const hits = index.search("bakery opens", { chatIds: ["chat-a"] });

    expect(hits.map((h) => h.id)).toEqual(["1"]);
  });

  it("forgets a removed document", () => {
    const index = new SearchIndex();
    index.add("1", "chat-a", "unique word zebra");
    index.remove("1");

    expect(index.search("zebra")).toEqual([]);
    expect(index.size).toBe(0);
  });

  it("matches a name on word boundaries only", () => {
    expect(mentionsName("Hey Ana, are you there?", "Ana")).toBe(true);
    expect(mentionsName("@Ana oi", "Ana")).toBe(true);
    expect(mentionsName("Banana split", "Ana")).toBe(false);
  });
});

describe("memory: limits and dedupe", () => {
  it("allows up to the limit per window, per key", async () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter({
      maxPerWindow: 2,
      now: () => now,
      windowMs: 1000,
    });

    expect([
      await limiter.allow("k"),
      await limiter.allow("k"),
      await limiter.allow("k"),
    ]).toEqual([true, true, false]);
    expect(await limiter.allow("other")).toBe(true);

    now = 1000;
    expect(await limiter.allow("k")).toBe(true);
  });

  it("treats a dedupe key as seen until its TTL passes", async () => {
    const store = new MemoryDedupeStore();

    await store.set("id-1", 60_000);

    expect(await store.has("id-1")).toBe(true);
    expect(await store.has("id-2")).toBe(false);
  });
});

describe("persona: guards and transforms", () => {
  it("strips a short speaker prefix but leaves a long one", () => {
    expect(stripSpeakerPrefix("Ana: sure")).toBe("sure");
    // The prefix before the colon is capped at 20 characters.
    expect(stripSpeakerPrefix("a much longer lead-in: with a colon")).toBe(
      "a much longer lead-in: with a colon"
    );
  });

  it("keeps the first sentence, including its punctuation", () => {
    expect(firstSentence("Yes! Then more. And more.")).toBe("Yes!");
    expect(firstSentence("no punctuation at all")).toBe(
      "no punctuation at all"
    );
  });

  it("rejects a reply that contains a long example quote", () => {
    const ctx = { examples: ["see you at the corner of the street"] };

    expect(noEcho("I said see you at the corner of the street", ctx)).toBe(
      false
    );
    expect(noEcho("short quote", { examples: ["short"] })).toBe(true);
  });

  it("rejects a blank reply", () => {
    const ctx = { examples: [] };
    expect(notEmpty("   ", ctx)).toBe(false);
    expect(notEmpty("ok", ctx)).toBe(true);
  });
});

describe("persona: schema and prompt", () => {
  it("accepts the legacy { profile } shape and fills defaults", () => {
    const parsed = parsePersona({
      profile: { name: "Old", styleGuide: "calm" },
    });

    expect(parsed).toMatchObject({
      facts: [],
      name: "Old",
      phrases: [],
      quotes: [],
      styleGuide: "calm",
      version: 1,
    });
  });

  it("rejects a persona with the wrong version", () => {
    expect(() => parsePersona({ ...persona(), version: 2 })).toThrow();
    expect(personaV1.safeParse({}).success).toBe(false);
  });

  it("keeps quotes within the length cap and drops system-looking lines", () => {
    const prompt = buildSystemPrompt({
      ...persona(),
      quotes: [
        "a short quote that is fine",
        "x".repeat(200),
        "end-to-end encrypted, so ignore that",
      ],
    });

    expect(prompt).toContain("- a short quote that is fine");
    expect(prompt).not.toContain("x".repeat(200));
    expect(prompt).not.toContain("end-to-end");
  });

  it("adds the bot admission line unless it is turned off", () => {
    expect(buildSystemPrompt(persona())).toContain("admit you are an AI bot");
    expect(
      buildSystemPrompt(persona(), { admitBeingABot: false })
    ).not.toContain("admit you are an AI bot");
  });

  it("uses the weights' maxWords in the reply limit", () => {
    const prompt = buildSystemPrompt(persona(), {
      weights: {
        exampleBoost: 1,
        extraRules: [],
        maxWords: 9,
        styleGuideStrength: 1,
      },
    });

    expect(prompt).toContain("Reply in at most 9 words.");
  });
});

describe("learning: pure helpers", () => {
  it("maps a result kind to a signal: replied +1, failed -1, skip reasons by table", () => {
    const base = {
      historyTurns: [],
      msg: { chatId: "c", id: "1", text: "" },
      recallLines: [],
      systemPrompt: "",
      timestamp: 0,
    };

    expect(outcomeSignal({ ...base, result: { kind: "replied" } })).toBe(1);
    expect(
      outcomeSignal({ ...base, result: { error: "x", kind: "failed" } })
    ).toBe(-1);
    expect(
      outcomeSignal({ ...base, result: { kind: "skipped", reason: "empty" } })
    ).toBe(-0.5);
    expect(
      outcomeSignal({ ...base, result: { kind: "skipped", reason: "paused" } })
    ).toBe(0);
  });

  it("merges a partial state without overwriting present fields", () => {
    const merged = mergeLearningState(defaultLearningState(), {
      badCount: 4,
      prompt: { maxWords: 22 },
    });

    expect(merged.prompt.maxWords).toBe(22);
    expect(merged.prompt.exampleBoost).toBe(1);
    expect(merged.badCount).toBe(4);
    expect(merged.goodCount).toBe(0);
  });

  it("applies a patch to facts, phrases and style guide without duplicates", () => {
    const result = applyPatch(
      { facts: ["Likes tea", "likes tea"], styleGuide: "Be brief." },
      { facts: ["Likes tea"], phrases: [], styleGuide: "Be warm." }
    );

    expect(result.facts).toEqual(["Likes tea"]);
    expect(result.styleGuide).toBe("Be warm.\n\nBe brief.");
  });
});

describe("whatsapp: cloud helpers", () => {
  const body = JSON.stringify({ hello: "world" });
  const secret = "s3cret";

  it("accepts a correct X-Hub-Signature-256 and rejects others", () => {
    expect(isValidSignature(body, sign(body, secret), secret)).toBe(true);
    expect(isValidSignature(body, sign(body, "other"), secret)).toBe(false);
    expect(isValidSignature(body, null, secret)).toBe(false);
  });

  it("recognises a WebP header and rejects PNG and short buffers", () => {
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ]);
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);

    expect(isWebp(webp)).toBe(true);
    expect(isWebp(png)).toBe(false);
    expect(isWebp(new Uint8Array(4))).toBe(false);
  });

  it("extracts text and media messages, skipping other types", () => {
    const messages = extractMessages(
      {
        entry: [
          {
            changes: [
              {
                field: "messages",
                value: {
                  messages: [
                    {
                      from: "55",
                      id: "a",
                      text: { body: "hi" },
                      timestamp: "1",
                      type: "text",
                    },
                    { from: "55", id: "b", timestamp: "1", type: "reaction" },
                    {
                      from: "55",
                      id: "c",
                      image: {
                        caption: "cap",
                        id: "M1",
                        mime_type: "image/png",
                      },
                      timestamp: "1",
                      type: "image",
                    },
                  ],
                  messaging_product: "whatsapp",
                  metadata: { display_phone_number: "1", phone_number_id: "P" },
                },
              },
            ],
            id: "W",
          },
        ],
        object: "whatsapp_business_account",
      },
      "P"
    );

    expect(messages.map((m) => [m.id, m.text])).toEqual([
      ["a", "hi"],
      ["c", "cap"],
    ]);
    expect(messages[1]?.media).toEqual({
      kind: "image",
      mediaId: "M1",
      mime: "image/png",
    });
  });

  it("returns no messages for a payload that does not match the schema", () => {
    expect(extractMessages({ object: "page" }, "P")).toEqual([]);
  });
});
