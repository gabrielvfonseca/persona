import type { WASocket } from "baileys";
import { describe, expect, it, vi } from "vitest";
import { BaileysChannel } from "../../src/baileys/channel";

describe("BaileysChannel", () => {
  it("sends messages sequentially", async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const sock = {
      sendPresenceUpdate: vi.fn(() => Promise.resolve()),
      sendMessage: vi.fn(async (_jid: string, body: { text: string }) => {
        sent.push(body.text);
      }),
    } as unknown as WASocket;
    const channel = new BaileysChannel(sock, "test");
    const p1 = channel.send("c1", "first");
    const p2 = channel.send("c1", "second");
    await vi.advanceTimersByTimeAsync(10000);
    await p1;
    await p2;
    vi.useRealTimers();
    expect(sent).toEqual(["first", "second"]);
  });
});
