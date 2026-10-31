import { describe, expect, it, vi } from "vitest";

type Handler = (update: Record<string, unknown>) => void;
const handlers: Record<string, Handler[]> = {};

vi.mock("qrcode-terminal", () => ({ default: { generate: () => {} } }));
vi.mock("baileys", () => {
  const sock = {
    ev: {
      on(event: string, fn: Handler) {
        handlers[event] = [...(handlers[event] ?? []), fn];
      },
    },
  };
  return {
    default: () => sock,
    DisconnectReason: { loggedOut: 401 },
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }),
    useMultiFileAuthState: async () => ({
      state: {},
      saveCreds: async () => {},
    }),
  };
});

import { connectBaileys } from "../../src/baileys/connect";

// Known bug: connect.ts sets `code = loggedOut` whenever lastDisconnect has ANY error,
// so a transient socket error reports "logged out" and never reconnects. It.fails stays
// green until a non-logout disconnect reports a reconnect.
describe("known issue: transient disconnects are reported as logged out", () => {
  it.fails("reconnects on a transient socket error", async () => {
    const statuses: string[] = [];
    await connectBaileys({
      authDir: "/tmp/unused",
      reconnect: true,
      onStatus: (s) => statuses.push(s),
    });

    for (const fn of handlers["connection.update"] ?? []) {
      fn({
        connection: "close",
        lastDisconnect: { error: new Error("socket reset") },
      });
    }

    expect(statuses.at(-1)).toMatch(/reconnecting/);
  });
});
