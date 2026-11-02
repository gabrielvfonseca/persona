import { describe, expect, it } from "vitest";
import { noBrazilian, noExplicit, noRunaway } from "../src/safety";

const ctx = { examples: [] };

describe("noExplicit", () => {
  it("lets ordinary chat through", () => {
    expect(noExplicit("Tudo bem, obrigado!", ctx)).toBe(true);
    expect(noExplicit("Okok, vamos arranjar um lugar para jogar.", ctx)).toBe(
      true
    );
  });

  it("blocks explicit sexual terms and insults", () => {
    expect(noExplicit("Ahahahah mas se quiseres … o teu caralho 😈", ctx)).toBe(
      false
    );
    expect(noExplicit("manda nudes", ctx)).toBe(false);
    expect(noExplicit("vamos foder", ctx)).toBe(false);
  });

  it("matches on word boundaries, not inside other words", () => {
    expect(noExplicit("o pintor chegou", ctx)).toBe(true);
    expect(noExplicit("paramos ao fim", ctx)).toBe(true);
  });
});

describe("noRunaway", () => {
  it("drops loops of one character or one word", () => {
    expect(noRunaway("Ahahaha, okkkkkkkkkkkkkkkkkkkk", ctx)).toBe(false);
    expect(noRunaway("nah nah nah nah bora", ctx)).toBe(false);
  });

  it("drops laughter runs that alternate with emoji", () => {
    expect(
      noRunaway("Ahahahah 😂 Ahahahah 😂 Ahahahah 😂 Ahahahah 😂", ctx)
    ).toBe(false);
  });

  it("keeps normal replies", () => {
    expect(noRunaway("Ahahah, kkkk tudo bem", ctx)).toBe(true);
    expect(noRunaway("Bom dia, vamos ao bar hoje?", ctx)).toBe(true);
  });
});

describe("noBrazilian", () => {
  it("drops Brazilian-only forms", () => {
    expect(noBrazilian("vc vai hoje?", ctx)).toBe(false);
    expect(noBrazilian("você quer ir pra festa", ctx)).toBe(false);
  });

  it("keeps European Portuguese", () => {
    expect(noBrazilian("tu vens hoje? estás em casa?", ctx)).toBe(true);
  });
});
