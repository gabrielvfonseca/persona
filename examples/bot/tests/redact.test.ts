import { describe, expect, it } from "vitest";
import { redactText } from "../src/persona-file";

describe("redactText", () => {
  it("replaces full names and name parts with a placeholder", () => {
    expect(redactText("o Artur Reves é fixe", ["Artur Reves", "Artur"])).toBe(
      "o alguém é fixe"
    );
    expect(redactText("diz ao Miguel", ["Miguel"])).toBe("diz ao alguém");
  });

  it("does not touch a name inside a longer word", () => {
    expect(redactText("Artúrio chegou", ["Artur"])).toBe("Artúrio chegou");
  });

  it("replaces phone numbers", () => {
    expect(redactText("liga +351 932 385 996 já", [])).toBe("liga alguém já");
  });
});
