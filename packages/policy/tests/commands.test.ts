import { describe, expect, it, vi } from "vitest";
import { createCommands } from "../src/commands";

describe("createCommands", () => {
  it("creates commands with options", () => {
    const state = { paused: false, setPaused: vi.fn() };
    const commands = createCommands({
      adminNumbers: ["123456"],
      botName: "TestBot",
      state,
    });
    expect(commands.commands.length).toBe(3);
    expect(commands.whois.name).toBe("!whois");
    expect(commands.pause.name).toBe("!pause");
    expect(commands.resume.name).toBe("!resume");
  });

  it("whois returns bot name", async () => {
    const state = { paused: false, setPaused: vi.fn() };
    const commands = createCommands({
      adminNumbers: ["123456"],
      botName: "TestBot",
      state,
    });
    const result = await commands.handle("!whois", "123456@s.whatsapp.net");
    expect(result.handled).toBe(true);
    expect(result.reply).toContain("TestBot");
  });

  it("returns not handled for unknown command", async () => {
    const state = { paused: false, setPaused: vi.fn() };
    const commands = createCommands({
      adminNumbers: ["123456"],
      botName: "TestBot",
      state,
    });
    const result = await commands.handle("!unknown", "123456@s.whatsapp.net");
    expect(result.handled).toBe(false);
    expect(result.reply).toBeUndefined();
  });

  it("pause requires admin", async () => {
    const state = { paused: false, setPaused: vi.fn() };
    const commands = createCommands({
      adminNumbers: ["123456"],
      botName: "TestBot",
      state,
    });
    const result = await commands.handle("!pause", "999999@s.whatsapp.net");
    expect(result.handled).toBe(false);
  });

  it("admin can pause bot", async () => {
    const setPaused = vi.fn();
    const state = { paused: false, setPaused };
    const commands = createCommands({
      adminNumbers: ["123456"],
      botName: "TestBot",
      state,
    });
    const result = await commands.handle("!pause", "123456@s.whatsapp.net");
    expect(result.handled).toBe(true);
    expect(result.reply).toBe("Bot paused.");
    expect(setPaused).toHaveBeenCalledWith(true);
  });

  it("admin can resume bot", async () => {
    const setPaused = vi.fn();
    const state = { paused: true, setPaused };
    const commands = createCommands({
      adminNumbers: ["123456"],
      botName: "TestBot",
      state,
    });
    const result = await commands.handle("!resume", "123456@s.whatsapp.net");
    expect(result.handled).toBe(true);
    expect(result.reply).toBe("Bot resumed.");
    expect(setPaused).toHaveBeenCalledWith(false);
  });

  it("isAdmin checks admin numbers", () => {
    const state = { paused: false, setPaused: vi.fn() };
    const commands = createCommands({
      adminNumbers: ["123456", "789012"],
      botName: "TestBot",
      state,
    });
    expect(commands.isAdmin("123456@s.whatsapp.net")).toBe(true);
    expect(commands.isAdmin("999999@s.whatsapp.net")).toBe(false);
  });

  it("isAdmin handles participants with device suffix", () => {
    const state = { paused: false, setPaused: vi.fn() };
    const commands = createCommands({
      adminNumbers: ["123456"],
      botName: "TestBot",
      state,
    });
    expect(commands.isAdmin("123456:12@s.whatsapp.net")).toBe(true);
  });

  it("normalizeId removes non-digits", () => {
    const state = { paused: false, setPaused: vi.fn() };
    const commands = createCommands({
      adminNumbers: ["123456"],
      botName: "TestBot",
      state,
    });
    expect(commands.normalizeId("123-456-789")).toBe("123456789");
    expect(commands.normalizeId("+1 (234) 567-8900")).toBe("12345678900");
  });

  it("handles commands with extra whitespace", async () => {
    const state = { paused: false, setPaused: vi.fn() };
    const commands = createCommands({
      adminNumbers: ["123456"],
      botName: "TestBot",
      state,
    });
    const result = await commands.handle("  !whois  ", "123456@s.whatsapp.net");
    expect(result.handled).toBe(true);
  });
});
