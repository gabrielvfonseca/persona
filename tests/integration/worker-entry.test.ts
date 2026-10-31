import { describe, expect, it, vi } from "vitest";
import { createWorker } from "../../examples/bot/src/worker";
import { cloudPayload, memoryKv, sign, textMessage } from "../helpers/fakes";

vi.mock("../../examples/bot/src/model", () => ({
  openRouterGenerator: () => ({ generate: async () => "Hello from Ana" }),
  openRouterDescriber: () => ({ describe: async () => "unused" }),
  openRouterEmbedder: () => ({ embed: async () => [] }),
}));

const APP_SECRET = "app-secret";
const ADMIN_KEY = "admin-pass";

const persona = {
  version: 1,
  name: "Ana",
  styleGuide: "Short and warm.",
  stats: { medianLen: 10, p90Len: 20 },
  quotes: [],
  phrases: [],
  facts: [],
};

const env = {
  PERSONA_CONSENT: "true",
  PERSONA_NAME: "Ana",
  PERSONA_MODEL: "openai/gpt-4o-mini",
  OPENROUTER_API_KEY: "sk-test",
  WHATSAPP_ACCESS_TOKEN: "graph-token",
  WHATSAPP_APP_SECRET: APP_SECRET,
  WHATSAPP_PHONE_NUMBER_ID: "PHONE_1",
  WHATSAPP_VERIFY_TOKEN: "verify-me",
  ADMIN_KEY,
  PERSONA_JSON: JSON.stringify(persona),
};

function bindings() {
  const forwarded: string[] = [];
  const stub = {
    fetch: async (req: Request) => {
      forwarded.push(new URL(req.url).pathname);
      return new Response(`durable:${new URL(req.url).pathname}`);
    },
  };
  return {
    forwarded,
    bindings: {
      CONVERSATIONS: memoryKv(),
      LEARNING: memoryKv(),
      WHATSAPP: {
        idFromName: (name: string) => name,
        get: (_id: unknown) => stub,
      },
    },
  };
}

const basic = (password: string) => `Basic ${btoa(`admin:${password}`)}`;

describe("Worker entry", () => {
  it("refuses to build without PERSONA_JSON", async () => {
    const { bindings: b } = bindings();
    const { PERSONA_JSON: _omit, ...withoutPersona } = env;

    await expect(createWorker(withoutPersona, b)).rejects.toThrow(
      /PERSONA_JSON is missing/,
    );
  });

  it("refuses to build when Cloud API secrets are missing", async () => {
    const { bindings: b } = bindings();
    const { WHATSAPP_ACCESS_TOKEN: _omit, ...partial } = env;

    await expect(createWorker(partial, b)).rejects.toThrow(
      /WHATSAPP_ACCESS_TOKEN/,
    );
  });

  it("answers the Meta verification handshake on /webhook/whatsapp", async () => {
    const { bindings: b } = bindings();
    const app = await createWorker(env, b);

    const res = await app.fetch(
      new Request(
        "https://bot.test/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=77",
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("77");
  });

  it("answers a signed inbound message through the bot", async () => {
    const { bindings: b } = bindings();
    // The client captures global fetch when the worker is built, so spy first.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const app = await createWorker(env, b);
    // Cloud API answers direct messages only when addressed by name (see buildBot).
    const body = cloudPayload(
      [textMessage("wamid.1", "5511888888888", "Ana, oi")],
      "PHONE_1",
    );
    try {
      const res = await app.fetch(
        new Request("https://bot.test/webhook/whatsapp", {
          method: "POST",
          headers: { "x-hub-signature-256": sign(body, APP_SECRET) },
          body,
        }),
      );

      expect(res.status).toBe(200);
      const graphCall = fetchSpy.mock.calls.find(([url]) =>
        String(url).includes("graph.facebook.com"),
      );
      expect(graphCall).toBeDefined();
      expect(String(graphCall?.[1]?.body)).toContain("Hello from Ana");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("serves /admin/persona only with the admin password", async () => {
    const { bindings: b } = bindings();
    const app = await createWorker(env, b);

    const denied = await app.fetch(
      new Request("https://bot.test/admin/persona"),
    );
    const wrong = await app.fetch(
      new Request("https://bot.test/admin/persona", {
        headers: { Authorization: basic("nope") },
      }),
    );
    const ok = await app.fetch(
      new Request("https://bot.test/admin/persona", {
        headers: { Authorization: basic(ADMIN_KEY) },
      }),
    );

    expect(denied.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, name: "Ana" });
  });

  it("proxies /cf-bot/* to the linked-device Durable Object, stripping the prefix", async () => {
    const { bindings: b, forwarded } = bindings();
    const app = await createWorker(env, b);

    const res = await app.fetch(
      new Request("https://bot.test/cf-bot/status", {
        headers: { Authorization: basic(ADMIN_KEY) },
      }),
    );

    expect(await res.text()).toBe("durable:/status");
    expect(forwarded).toEqual(["/status"]);
  });

  it("does not reach the Durable Object without the admin password", async () => {
    const { bindings: b, forwarded } = bindings();
    const app = await createWorker(env, b);

    const res = await app.fetch(new Request("https://bot.test/cf-bot/status"));

    expect(res.status).toBe(401);
    expect(forwarded).toEqual([]);
  });
});
