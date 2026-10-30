import { describe, expect, it } from "vitest";
import { buildExchanges, trainFromExport } from "../src/index";

const msg = (sender: string, text: string, windowId = 0) => ({
  sender,
  text,
  windowId,
});

describe("buildExchanges", () => {
  it("pairs what someone else said with the target's reply", () => {
    const pairs = buildExchanges(
      [msg("Bia", "vamos hoje?"), msg("Ana", "bora!"), msg("Ana", "oi")],
      "Ana",
    );
    expect(pairs).toEqual([{ user: "vamos hoje?", assistant: "bora!" }]);
  });

  it("never pairs across conversation windows", () => {
    const pairs = buildExchanges(
      [msg("Bia", "hi", 0), msg("Ana", "hey", 1)],
      "Ana",
    );
    expect(pairs).toEqual([]);
  });

  it("skips media, links and overlong text", () => {
    const pairs = buildExchanges(
      [
        msg("Bia", "<Media omitted>"),
        msg("Ana", "nice"),
        msg("Bia", "see https://example.com"),
        msg("Ana", "wow"),
        msg("Bia", "x".repeat(200)),
        msg("Ana", "short"),
      ],
      "Ana",
    );
    expect(pairs).toEqual([]);
  });

  it("spreads the kept pairs across the export", () => {
    const messages = Array.from({ length: 100 }, (_, i) => [
      msg("Bia", `q${i}`),
      msg("Ana", `a${i}`),
    ]).flat();
    const pairs = buildExchanges(messages, "Ana", { maxExchanges: 4 });
    expect(pairs.map((p) => p.user)).toEqual(["q0", "q25", "q50", "q75"]);
  });
});

describe("trainFromExport", () => {
  it("includes exchanges learned from the export", () => {
    const raw = [
      "[29/10/2026, 18:50:01] Bia: vamos amanhã?",
      "[29/10/2026, 18:51:10] Ana: bora sim",
    ].join("\n");
    const persona = trainFromExport(raw, { sender: "Ana" });
    expect(persona.exchanges).toEqual([
      { user: "vamos amanhã?", assistant: "bora sim" },
    ]);
  });
});
