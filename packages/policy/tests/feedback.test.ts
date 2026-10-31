import { describe, expect, it, vi } from "vitest";
import { createCommands } from "../src/commands";

describe("feedback commands", () => {
  it("!good calls onRate with +1", async () => {
    const onRate = vi.fn();
    const commands = createCommands({
      adminNumbers: ["5511"],
      botName: "Ana",
      onRate,
      state: {
        paused: false,
        setPaused() {
          /* intentionally empty */
        },
      },
    });
    const r = await commands.handle("!good", "5511@s.whatsapp.net", {
      chatId: "c1",
    });
    expect(r.handled).toBe(true);
    expect(r.reply).toContain("good");
    expect(onRate).toHaveBeenCalledWith("c1", 1, undefined);
  });

  it("!bad calls onRate with -1 and comment", async () => {
    const onRate = vi.fn();
    const commands = createCommands({
      adminNumbers: ["5511"],
      botName: "Ana",
      onRate,
      state: {
        paused: false,
        setPaused() {
          /* intentionally empty */
        },
      },
    });
    const r = await commands.handle("!bad too long", "5511@s.whatsapp.net", {
      chatId: "c1",
    });
    expect(r.handled).toBe(true);
    expect(onRate).toHaveBeenCalledWith("c1", -1, "too long");
  });

  it("!weights returns the weights callback output", async () => {
    const commands = createCommands({
      adminNumbers: ["5511"],
      botName: "Ana",
      onWeights: () => "weights: maxWords=15",
      state: {
        paused: false,
        setPaused() {
          /* intentionally empty */
        },
      },
    });
    const r = await commands.handle("!weights", "5511@s.whatsapp.net");
    expect(r.reply).toBe("weights: maxWords=15");
  });

  it("non-admin cannot rate", async () => {
    const onRate = vi.fn();
    const commands = createCommands({
      adminNumbers: ["5511"],
      botName: "Ana",
      onRate,
      state: {
        paused: false,
        setPaused() {
          /* intentionally empty */
        },
      },
    });
    const r = await commands.handle("!good", "5599@s.whatsapp.net");
    expect(r.handled).toBe(false);
    expect(onRate).not.toHaveBeenCalled();
  });
});
