import { describe, expect, it, vi } from "vitest";
import { WhatsappSocketChannel } from "../src/channel";

describe("WhatsappSocketChannel", () => {
  it("sends messages sequentially", async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const sock = {
      sendMessage: vi.fn((_jid: string, body: { text: string }) => {
        sent.push(body.text);
        return Promise.resolve();
      }),
      sendPresenceUpdate: vi.fn(() => Promise.resolve()),
    };
    const channel = new WhatsappSocketChannel(sock, "test");
    const p1 = channel.send("c1", "first");
    const p2 = channel.send("c1", "second");
    await vi.advanceTimersByTimeAsync(10_000);
    await p1;
    await p2;
    vi.useRealTimers();
    expect(sent).toEqual(["first", "second"]);
  });
});
