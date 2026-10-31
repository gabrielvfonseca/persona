import { describe, expect, it } from "vitest";
import { createCommands } from "../src/commands";

const state = {
  paused: false,
  setPaused() {
    /* intentionally empty */
  },
};

describe("!learn", () => {
  it("says fact storage is off when no hook is given", async () => {
    const commands = createCommands({
      adminNumbers: ["1"],
      botName: "Ana",
      state,
    });

    const result = await commands.handle("!learn likes green tea", "1");

    expect(result.reply).toBe("Fact storage is not enabled.");
  });

  it("passes the fact to the hook and says so only after it is stored", async () => {
    const stored: string[] = [];
    const commands = createCommands({
      adminNumbers: ["1"],
      botName: "Ana",
      onLearn: (fact) => {
        stored.push(fact);
      },
      state,
    });

    const result = await commands.handle("!learn likes green tea", "1");

    expect(stored).toEqual(["likes green tea"]);
    expect(result.reply).toBe("Learned.");
  });

  it("does not call the hook without a fact", async () => {
    const stored: string[] = [];
    const commands = createCommands({
      adminNumbers: ["1"],
      botName: "Ana",
      onLearn: (fact) => {
        stored.push(fact);
      },
      state,
    });

    const result = await commands.handle("!learn   ", "1");

    expect(stored).toEqual([]);
    expect(result.reply).toBe("Usage: !learn <fact>");
  });

  it("is admin only", async () => {
    const stored: string[] = [];
    const commands = createCommands({
      adminNumbers: ["1"],
      botName: "Ana",
      onLearn: (fact) => {
        stored.push(fact);
      },
      state,
    });

    const result = await commands.handle("!learn likes green tea", "2");

    expect(result.handled).toBe(false);
    expect(stored).toEqual([]);
  });
});
