import { createPersona } from "@persona/persona";
import {
  type BackgroundTasks,
  createWhatsappWebhook,
  WhatsappClient,
} from "@persona/whatsapp";
import { describe, expect, it, vi } from "vitest";
import {
  cloudPayload,
  fakeDescriber,
  fakeGenerator,
  persona,
  sign,
  silentLogger,
  textMessage,
} from "../helpers/fakes";

const APP_SECRET = "app-secret";
const VERIFY_TOKEN = "verify-me";
const PHONE_ID = "PHONE_1";
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

/** Wires the real SDK, Cloud API client and webhook together, with fetch stubbed. */
function stack(
  opts: {
    reply?: string;
    describer?: ReturnType<typeof fakeDescriber>;
    downloadMedia?: (id: string, maxBytes: number) => Promise<Uint8Array>;
  } = {}
) {
  const graphCalls: { url: string; init: RequestInit }[] = [];
  const fetchStub = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    graphCalls.push({ init: init ?? {}, url: String(url) });
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  const client = new WhatsappClient({
    accessToken: "graph-token",
    fetch: fetchStub,
    phoneNumberId: PHONE_ID,
  });
  const generator = fakeGenerator(opts.reply ?? "Hi there");
  const bot = createPersona({
    channel: client,
    describer: opts.describer,
    generator,
    logger: silentLogger,
    persona: persona(),
    policy: { direct: "always" },
  });
  const webhook = createWhatsappWebhook({
    appSecret: APP_SECRET,
    bot,
    downloadMedia: opts.downloadMedia,
    phoneNumberId: PHONE_ID,
    verifyToken: VERIFY_TOKEN,
  });
  const post = (
    body: string,
    signature = sign(body, APP_SECRET),
    ctx?: BackgroundTasks
  ) =>
    webhook(
      new Request("https://bot.test/webhook/whatsapp", {
        body,
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": signature,
        },
        method: "POST",
      }),
      ctx
    );
  return { bot, generator, graphCalls, post, webhook };
}

describe("webhook verification (GET)", () => {
  it("echoes the challenge when the verify token matches", async () => {
    const { webhook } = stack();

    const res = await webhook(
      new Request(
        `https://bot.test/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=4242`
      )
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("4242");
  });

  it("rejects a wrong verify token", async () => {
    const { webhook } = stack();

    const res = await webhook(
      new Request(
        "https://bot.test/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=4242"
      )
    );

    expect(res.status).toBe(403);
  });

  it("answers 405 for methods other than GET and POST", async () => {
    const { webhook } = stack();

    const res = await webhook(
      new Request("https://bot.test/webhook/whatsapp", { method: "PUT" })
    );

    expect(res.status).toBe(405);
  });
});

describe("message flow (POST)", () => {
  it("routes a text message through the SDK and sends the reply via the Graph API", async () => {
    const { post, graphCalls, generator } = stack({ reply: "Hi there" });
    const body = cloudPayload([
      textMessage("wamid.1", "5511888888888", "oi, tudo bem?"),
    ]);

    const res = await post(body);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
    expect(generator.calls[0]?.messages.at(-1)?.content).toBe("oi, tudo bem?");
    expect(graphCalls).toHaveLength(1);
    expect(graphCalls[0]?.url).toBe(
      `https://graph.facebook.com/v22.0/${PHONE_ID}/messages`
    );
    const sent = JSON.parse(String(graphCalls[0]?.init.body));
    expect(sent).toMatchObject({
      context: { message_id: "wamid.1" },
      messaging_product: "whatsapp",
      text: { body: "Hi there" },
      to: "5511888888888",
      type: "text",
    });
  });

  it("sends the Graph API bearer token", async () => {
    const { post, graphCalls } = stack();

    await post(cloudPayload([textMessage("wamid.1", "5511888888888", "oi")]));

    const headers = new Headers(graphCalls[0]?.init.headers);
    expect(headers.get("Authorization")).toBe("Bearer graph-token");
  });

  it("rejects a body whose signature does not match, and does not reply", async () => {
    const { post, graphCalls, generator } = stack();
    const body = cloudPayload([textMessage("wamid.1", "5511888888888", "oi")]);

    const res = await post(body, sign(`${body} `, APP_SECRET));

    expect(res.status).toBe(403);
    expect(generator.calls).toHaveLength(0);
    expect(graphCalls).toHaveLength(0);
  });

  it("rejects a missing signature header", async () => {
    const { webhook } = stack();

    const res = await webhook(
      new Request("https://bot.test/webhook/whatsapp", {
        body: cloudPayload([textMessage("wamid.1", "5511888888888", "oi")]),
        method: "POST",
      })
    );

    expect(res.status).toBe(403);
  });

  it("ignores messages sent to a different phone number id", async () => {
    const { post, graphCalls, generator } = stack();
    const body = cloudPayload(
      [textMessage("wamid.1", "5511888888888", "oi")],
      "SOMEONE_ELSE"
    );

    const res = await post(body);

    expect(res.status).toBe(200);
    expect(generator.calls).toHaveLength(0);
    expect(graphCalls).toHaveLength(0);
  });

  it("answers OK to a body that is not JSON", async () => {
    const { post, generator } = stack();

    const res = await post("not json");

    expect(res.status).toBe(200);
    expect(generator.calls).toHaveLength(0);
  });

  it("answers OK to a payload with no messages, such as a status update", async () => {
    const { post, generator } = stack();
    const body = JSON.stringify({
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "1",
                  phone_number_id: PHONE_ID,
                },
                statuses: [{ id: "wamid.9", status: "delivered" }],
              },
            },
          ],
          id: "WABA_1",
        },
      ],
      object: "whatsapp_business_account",
    });

    const res = await post(body);

    expect(res.status).toBe(200);
    expect(generator.calls).toHaveLength(0);
  });

  it("passes an image to the describer and includes the description in the prompt", async () => {
    const describer = fakeDescriber("a sunset over the sea");
    const downloads: { id: string; maxBytes: number }[] = [];
    const { post, generator } = stack({
      describer,
      downloadMedia: (id, maxBytes) => {
        downloads.push({ id, maxBytes });
        return Promise.resolve(JPEG);
      },
    });
    const body = cloudPayload([
      {
        from: "5511888888888",
        id: "wamid.img",
        image: {
          caption: "look at this",
          id: "MEDIA_9",
          mime_type: "image/jpeg",
        },
        timestamp: "1700000000",
        type: "image",
      },
    ]);

    await post(body);

    expect(downloads).toEqual([{ id: "MEDIA_9", maxBytes: 5 * 1024 * 1024 }]);
    expect(describer.seen).toEqual([
      { bytes: JPEG.byteLength, mime: "image/jpeg" },
    ]);
    expect(generator.calls[0]?.messages.at(-1)?.content).toBe(
      "look at this [image: a sunset over the sea]"
    );
  });

  it("drops a sticker that is not WebP before it reaches the model", async () => {
    const describer = fakeDescriber();
    const { post, generator } = stack({
      describer,
      downloadMedia: () => Promise.resolve(JPEG),
    });
    const body = cloudPayload([
      {
        from: "5511888888888",
        id: "wamid.st",
        sticker: { id: "MEDIA_3", mime_type: "image/webp" },
        timestamp: "1700000000",
        type: "sticker",
      },
    ]);

    const res = await post(body);

    expect(res.status).toBe(200);
    expect(describer.seen).toHaveLength(0);
    expect(generator.calls).toHaveLength(0);
  });

  it("keeps a sticker that is valid WebP", async () => {
    const describer = fakeDescriber("a waving cat");
    const { post, generator } = stack({
      describer,
      downloadMedia: () => Promise.resolve(WEBP),
    });
    const body = cloudPayload([
      {
        from: "5511888888888",
        id: "wamid.st",
        sticker: { id: "MEDIA_3", mime_type: "image/webp" },
        timestamp: "1700000000",
        type: "sticker",
      },
    ]);

    await post(body);

    expect(generator.calls[0]?.messages.at(-1)?.content).toBe(
      " [sticker: a waving cat]"
    );
  });

  it("still answers the caption when the image download fails", async () => {
    const { post, generator } = stack({
      downloadMedia: () => Promise.reject(new Error("graph 500")),
    });
    const body = cloudPayload([
      {
        from: "5511888888888",
        id: "wamid.img",
        image: {
          caption: "look at this",
          id: "MEDIA_9",
          mime_type: "image/jpeg",
        },
        timestamp: "1700000000",
        type: "image",
      },
    ]);

    await post(body);

    expect(generator.calls[0]?.messages.at(-1)?.content).toBe("look at this");
  });

  it("hands the work to waitUntil when a background context is present", async () => {
    const { post, graphCalls } = stack();
    const pending: Promise<unknown>[] = [];
    const ctx: BackgroundTasks = {
      waitUntil: (p) => {
        pending.push(p);
      },
    };

    const res = await post(
      cloudPayload([textMessage("wamid.1", "5511888888888", "oi")]),
      undefined,
      ctx
    );

    expect(res.status).toBe(200);
    expect(pending).toHaveLength(1);
    expect(graphCalls).toHaveLength(0);
    await Promise.all(pending);
    expect(graphCalls).toHaveLength(1);
  });
});
