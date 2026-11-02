import { describe, expect, it } from "vitest";
import { personalAnswer } from "../src/personal";

describe("personalAnswer", () => {
  it("answers confirmed facts", () => {
    expect(personalAnswer("tens animais de estimação?")).toBe("Tenho um cão.");
    expect(personalAnswer("tens irmãos?")).toBe("Tenho uma irmã.");
    expect(personalAnswer("de que equipa és?")).toBe("Sou do Benfica.");
  });

  it("deflects what is not in the facts", () => {
    expect(personalAnswer("quantos anos tens?")).toContain("não te digo");
    expect(personalAnswer("de onde és?")).toContain("não te digo");
  });

  it("admits being a bot", () => {
    expect(personalAnswer("és um robô?")).toBe(
      "Sou um bot que fala como o Calhau."
    );
  });

  it("leaves ordinary chat to the model", () => {
    expect(personalAnswer("bora jogar bola hoje à noite?")).toBeUndefined();
  });
});
