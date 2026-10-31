import { createHmac } from "node:crypto";
import type { IncomingMessage } from "@persona/core";
import { describe, expect, it, vi } from "vitest";
import { createWhatsappWebhook } from "../src/webhook";

const SECRET = "app-secret";
const VERIFY = "verify-me";

function setup() {
  const handled: IncomingMessage[] = [];
  const webhook = createWhatsappWebhook({
    appSecret: SECRET,
    bot: {
      handle: vi.fn((msg: IncomingMessage) => {
        handled.push(msg);
        return Promise.resolve({ kind: "replied" as const });
      }),
    },
    phoneNumberId: "1001",
    verifyToken: VERIFY,
  });
  return { handled, webhook };
}

const payload = JSON.stringify({
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: {
            messages: [
              {
                from: "5511",
                id: "wamid.1",
                text: { body: "hi" },
                timestamp: "1",
                type: "text",
              },
            ],
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "1", phone_number_id: "1001" },
          },
        },
      ],
      id: "waba",
    },
  ],
  object: "whatsapp_business_account",
});

const signed = (body: string) =>
  `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;

describe("GET handshake", () => {
  it("echoes the challenge for the right token", async () => {
    const { webhook } = setup();
    const res = await webhook(
      new Request(
        `https://x/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=123`
      )
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("123");
  });
  it("refuses a wrong token", async () => {
    const { webhook } = setup();
    const res = await webhook(
      new Request(
        "https://x/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=123"
      )
    );
    expect(res.status).toBe(403);
  });
});

describe("POST messages", () => {
  it("rejects a bad signature without calling the bot", async () => {
    const { webhook, handled } = setup();
    const res = await webhook(
      new Request("https://x/webhook", {
        body: payload,
        headers: { "x-hub-signature-256": "sha256=00" },
        method: "POST",
      })
    );
    expect(res.status).toBe(403);
    expect(handled).toHaveLength(0);
  });
  it("hands a correctly signed message to the bot", async () => {
    const { webhook, handled } = setup();
    const res = await webhook(
      new Request("https://x/webhook", {
        body: payload,
        headers: { "x-hub-signature-256": signed(payload) },
        method: "POST",
      })
    );
    expect(res.status).toBe(200);
    expect(handled.map((m) => m.text)).toEqual(["hi"]);
  });
  it("answers 200 before the bot finishes when an execution context is given", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const handled: string[] = [];
    const webhook = createWhatsappWebhook({
      appSecret: SECRET,
      bot: {
        handle: vi.fn(async (msg: IncomingMessage) => {
          await gate;
          handled.push(msg.text);
          return { kind: "replied" as const };
        }),
      },
      phoneNumberId: "1001",
      verifyToken: VERIFY,
    });
    const background: Promise<unknown>[] = [];
    const res = await webhook(
      new Request("https://x/webhook", {
        body: payload,
        headers: { "x-hub-signature-256": signed(payload) },
        method: "POST",
      }),
      { waitUntil: (p) => background.push(p) }
    );
    expect(res.status).toBe(200);
    expect(handled).toHaveLength(0);
    release();
    await Promise.all(background);
    expect(handled).toEqual(["hi"]);
  });
});

describe("media", () => {
  const imagePayload = JSON.stringify({
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              messages: [
                {
                  from: "5511",
                  id: "wamid.img",
                  image: { id: "img-1", mime_type: "image/jpeg" },
                  timestamp: "1",
                  type: "image",
                },
              ],
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "1", phone_number_id: "1001" },
            },
          },
        ],
        id: "waba",
      },
    ],
    object: "whatsapp_business_account",
  });

  it("downloads media and passes the bytes to the bot", async () => {
    const seen: IncomingMessage[] = [];
    const webhook = createWhatsappWebhook({
      appSecret: SECRET,
      bot: {
        handle: vi.fn((msg: IncomingMessage) => {
          seen.push(msg);
          return Promise.resolve({ kind: "replied" as const });
        }),
      },
      downloadMedia: (id) => Promise.resolve(new Uint8Array([id.length])),
      phoneNumberId: "1001",
      verifyToken: VERIFY,
    });
    await webhook(
      new Request("https://x/webhook", {
        body: imagePayload,
        headers: { "x-hub-signature-256": signed(imagePayload) },
        method: "POST",
      }),
      { waitUntil: (p) => p }
    );
    expect(seen[0]?.media?.[0]).toMatchObject({
      kind: "image",
      mime: "image/jpeg",
    });
  });

  it("skips a media-only message whose download fails", async () => {
    const seen: IncomingMessage[] = [];
    const webhook = createWhatsappWebhook({
      appSecret: SECRET,
      bot: {
        handle: vi.fn((msg: IncomingMessage) => {
          seen.push(msg);
          return Promise.resolve({ kind: "replied" as const });
        }),
      },
      downloadMedia: () => Promise.reject(new Error("boom")),
      phoneNumberId: "1001",
      verifyToken: VERIFY,
    });
    await webhook(
      new Request("https://x/webhook", {
        body: imagePayload,
        headers: { "x-hub-signature-256": signed(imagePayload) },
        method: "POST",
      }),
      { waitUntil: (p) => p }
    );
    expect(seen).toHaveLength(0);
  });
});
