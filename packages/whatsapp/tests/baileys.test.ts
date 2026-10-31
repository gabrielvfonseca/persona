import { describe, expect, it, vi } from "vitest";
import { WhatsappSocketChannel } from "../src/channel";

describe("WhatsappSocketChannel", () => {
  it("has name baileys", () => {
    const sock = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
    };
    const channel = new WhatsappSocketChannel(sock);
    expect(channel.name).toBe("whatsapp");
  });

  it("sends message", async () => {
    const sock = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
    };
    const channel = new WhatsappSocketChannel(sock);
    await channel.send("123@s.whatsapp.net", "hi", "msg123");
    expect(sock.sendMessage).toHaveBeenCalled();
  });
});
