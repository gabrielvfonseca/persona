import { describe, expect, it } from "vitest";
import { createCommands } from "../src/commands";

// Known bug: `!learn` replies "Learned." but nothing is stored. CommandsOptions has no
// hook to receive the fact. It.fails stays green until the reply stops claiming success.
describe("known issue: !learn reports success without storing a fact", () => {
  it.fails("does not claim it learned a fact unless a hook stores it", async () => {
    const commands = createCommands({
      adminNumbers: ["1"],
      botName: "Ana",
      state: { paused: false, setPaused() {} },
    });

    const result = await commands.handle("!learn likes green tea", "1");

    expect(result.reply).not.toBe("Learned.");
  });
});
