import type { WASocket } from "baileys";
import { describe, expect, it, vi } from "vitest";
import { BaileysChannel } from "../../src/baileys/channel";

describe("BaileysChannel", () => {
  it("has name baileys", () => {
    const sock = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
    } as unknown as WASocket;
    const channel = new BaileysChannel(sock);
    expect(channel.name).toBe("baileys");
  });

  it("sends message", async () => {
    const sock = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
    } as unknown as WASocket;
    const channel = new BaileysChannel(sock);
    await channel.send("123@s.whatsapp.net", "hi", "msg123");
    expect(sock.sendMessage).toHaveBeenCalled();
  });
});
