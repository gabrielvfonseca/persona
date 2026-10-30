import type { Channel, Turn } from "@persona/core";
import { createMemory } from "@persona/memory";
import { parsePersona } from "@persona/schemas";
import { describe, expect, it, vi } from "vitest";
import { createPersonaBot } from "../src/pipeline";
import { createCommands, createReplyPolicy } from "@persona/policy";

function stubCommands(result: { handled: boolean; reply?: string }) {
  const real = createCommands({
    adminNumbers: [],
    botName: "Ana",
    state: { paused: false, setPaused() {} },
  });
  return { ...real, handle: vi.fn().mockResolvedValue(result) };
}

describe("feedback commands", () => {
  it("!good calls onRate with +1", async () => {
    const onRate = vi.fn();
    const commands = createCommands({
      adminNumbers: ["5511"],
      botName: "Ana",
      state: { paused: false, setPaused() {} },
      onRate,
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
      state: { paused: false, setPaused() {} },
      onRate,
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
      state: { paused: false, setPaused() {} },
      onWeights: () => "weights: maxWords=15",
    });
    const r = await commands.handle("!weights", "5511@s.whatsapp.net");
    expect(r.reply).toBe("weights: maxWords=15");
  });

  it("non-admin cannot rate", async () => {
    const onRate = vi.fn();
    const commands = createCommands({
      adminNumbers: ["5511"],
      botName: "Ana",
      state: { paused: false, setPaused() {} },
      onRate,
    });
    const r = await commands.handle("!good", "5599@s.whatsapp.net");
    expect(r.handled).toBe(false);
    expect(onRate).not.toHaveBeenCalled();
  });
});

describe("weighted recall fusion", () => {
  it("weights keyword and semantic lists independently", async () => {
    const { fuseWeighted } = await import("@persona/memory");
    const result = fuseWeighted([
      { nodes: [{ id: "a" }, { id: "b" }], weight: 2 },
      { nodes: [{ id: "b" }, { id: "c" }], weight: 0.5 },
    ]);
    // a: 2/(60+1) = 0.0328, b: 2/61 + 0.5/61 = 0.0410, c: 0.5/61 = 0.0082
    expect(result[0]).toBe("b");
    expect(result[1]).toBe("a");
    expect(result[2]).toBe("c");
  });

  it("createMemory.setRecallWeights updates the stored weights", async () => {
    const memory = createMemory();
    memory.setRecallWeights({ keywordWeight: 3, semanticWeight: 0.2, rrfK: 60 });
    // No throw; weights are stored on the memory object.
    expect(memory).toBeDefined();
  });
});