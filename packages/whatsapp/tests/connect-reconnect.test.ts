import { describe, expect, it, vi } from "vitest";
import { connectWhatsappSocket, isLoggedOut } from "../src/connect";

type Handler = (update: Record<string, unknown>) => void;
const handlers: Partial<Record<string, Handler[]>> = {};

vi.mock("qrcode-terminal", () => ({
  default: {
    generate: () => {
      /* intentionally empty */
    },
  },
}));
vi.mock("baileys", () => {
  const sock = {
    ev: {
      on(event: string, fn: Handler) {
        handlers[event] = [...(handlers[event] ?? []), fn];
      },
    },
  };
  return {
    DisconnectReason: { loggedOut: 401 },
    default: () => sock,
    fetchLatestBaileysVersion: () => Promise.resolve({ version: [2, 3000, 1] }),
    useMultiFileAuthState: () =>
      Promise.resolve({
        saveCreds: () => Promise.resolve(),
        state: {},
      }),
  };
});

const PATTERN_1 = /reconnecting/u;
const PATTERN_2 = /reconnecting/u;

/** A Boom-like error, the shape Baileys uses for disconnects. */
const boom = (statusCode: number) =>
  Object.assign(new Error(`status ${statusCode}`), { output: { statusCode } });

/** Opens a socket, then sends one `connection.update` to its listeners. */
async function disconnect(lastDisconnect: unknown, reconnect = true) {
  const statuses: string[] = [];
  for (const key of Object.keys(handlers)) {
    delete handlers[key];
  }
  await connectWhatsappSocket({
    authDir: "/tmp/unused",
    onStatus: (s) => statuses.push(s),
    reconnect,
  });
  for (const fn of handlers["connection.update"] ?? []) {
    fn({ connection: "close", lastDisconnect });
  }
  return statuses;
}

describe("disconnect handling", () => {
  it("reconnects after a transient socket error", async () => {
    const statuses = await disconnect({ error: boom(515) });

    expect(statuses.at(-1)).toMatch(PATTERN_1);
  });

  it("reconnects when the error has no status code", async () => {
    const statuses = await disconnect({ error: new Error("socket reset") });

    expect(statuses.at(-1)).toMatch(PATTERN_2);
  });

  it("reports a logout only for the logged-out status code", async () => {
    const statuses = await disconnect({ error: boom(401) });

    expect(statuses.at(-1)).toBe("logged out");
  });

  it("reports closed without reconnecting when reconnect is off", async () => {
    const statuses = await disconnect({ error: boom(515) }, false);

    expect(statuses.at(-1)).toBe("closed");
  });

  it("isLoggedOut reads only output.statusCode", () => {
    expect(isLoggedOut(boom(401))).toBe(true);
    expect(isLoggedOut(boom(408))).toBe(false);
    expect(isLoggedOut(new Error("401"))).toBe(false);
    expect(isLoggedOut(undefined)).toBe(false);
  });
});
