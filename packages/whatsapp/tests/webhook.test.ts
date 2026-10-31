import { createHmac } from "node:crypto";
import type { IncomingMessage } from "@persona/core";
import { describe, expect, it, vi } from "vitest";
import { createCloudApiWebhook } from "../../src/cloud/webhook";

const SECRET = "app-secret";
const VERIFY = "verify-me";

function setup() {
  const handled: IncomingMessage[] = [];
  const webhook = createCloudApiWebhook({
    bot: {
      handle: vi.fn(async (msg: IncomingMessage) => {
        handled.push(msg);
        return { kind: "replied" as const };
      }),
    },
    appSecret: SECRET,
    verifyToken: VERIFY,
    phoneNumberId: "1001",
  });
  return { webhook, handled };
}

const payload = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "waba",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "1", phone_number_id: "1001" },
            messages: [
              {
                from: "5511",
                id: "wamid.1",
                timestamp: "1",
                type: "text",
                text: { body: "hi" },
              },
            ],
          },
        },
      ],
    },
  ],
});

const signed = (body: string) =>
  `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;

describe("GET handshake", () => {
  it("echoes the challenge for the right token", async () => {
    const { webhook } = setup();
    const res = await webhook(
      new Request(
        `https://x/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=123`,
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("123");
  });
  it("refuses a wrong token", async () => {
    const { webhook } = setup();
    const res = await webhook(
      new Request(
        "https://x/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=123",
      ),
    );
    expect(res.status).toBe(403);
  });
});

describe("POST messages", () => {
  it("rejects a bad signature without calling the bot", async () => {
    const { webhook, handled } = setup();
    const res = await webhook(
      new Request("https://x/webhook", {
        method: "POST",
        headers: { "x-hub-signature-256": "sha256=00" },
        body: payload,
      }),
    );
    expect(res.status).toBe(403);
    expect(handled).toHaveLength(0);
  });
  it("hands a correctly signed message to the bot", async () => {
    const { webhook, handled } = setup();
    const res = await webhook(
      new Request("https://x/webhook", {
        method: "POST",
        headers: { "x-hub-signature-256": signed(payload) },
        body: payload,
      }),
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
    const webhook = createCloudApiWebhook({
      bot: {
        handle: vi.fn(async (msg: IncomingMessage) => {
          await gate;
          handled.push(msg.text);
          return { kind: "replied" as const };
        }),
      },
      appSecret: SECRET,
      verifyToken: VERIFY,
      phoneNumberId: "1001",
    });
    const background: Promise<unknown>[] = [];
    const res = await webhook(
      new Request("https://x/webhook", {
        method: "POST",
        headers: { "x-hub-signature-256": signed(payload) },
        body: payload,
      }),
      { waitUntil: (p) => background.push(p) },
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
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "1", phone_number_id: "1001" },
              messages: [
                {
                  from: "5511",
                  id: "wamid.img",
                  timestamp: "1",
                  type: "image",
                  image: { id: "img-1", mime_type: "image/jpeg" },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  it("downloads media and passes the bytes to the bot", async () => {
    const seen: IncomingMessage[] = [];
    const webhook = createCloudApiWebhook({
      bot: {
        handle: vi.fn(async (msg: IncomingMessage) => {
          seen.push(msg);
          return { kind: "replied" as const };
        }),
      },
      appSecret: SECRET,
      verifyToken: VERIFY,
      phoneNumberId: "1001",
      downloadMedia: async (id) => new Uint8Array([id.length]),
    });
    await webhook(
      new Request("https://x/webhook", {
        method: "POST",
        headers: { "x-hub-signature-256": signed(imagePayload) },
        body: imagePayload,
      }),
      { waitUntil: (p) => p },
    );
    expect(seen[0]?.media?.[0]).toMatchObject({
      kind: "image",
      mime: "image/jpeg",
    });
  });

  it("skips a media-only message whose download fails", async () => {
    const seen: IncomingMessage[] = [];
    const webhook = createCloudApiWebhook({
      bot: {
        handle: vi.fn(async (msg: IncomingMessage) => {
          seen.push(msg);
          return { kind: "replied" as const };
        }),
      },
      appSecret: SECRET,
      verifyToken: VERIFY,
      phoneNumberId: "1001",
      downloadMedia: async () => {
        throw new Error("boom");
      },
    });
    await webhook(
      new Request("https://x/webhook", {
        method: "POST",
        headers: { "x-hub-signature-256": signed(imagePayload) },
        body: imagePayload,
      }),
      { waitUntil: (p) => p },
    );
    expect(seen).toHaveLength(0);
  });
});
