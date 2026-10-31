import { createPersona } from "@persona/persona";
import {
  CloudApiClient,
  createCloudApiWebhook,
  type ExecutionContextLike,
} from "@persona/whatsapp/cloud";
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
  } = {},
) {
  const graphCalls: { url: string; init: RequestInit }[] = [];
  const fetchStub = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      graphCalls.push({ url: String(url), init: init ?? {} });
      return new Response("{}", { status: 200 });
    },
  ) as unknown as typeof fetch;
  const client = new CloudApiClient({
    phoneNumberId: PHONE_ID,
    accessToken: "graph-token",
    fetch: fetchStub,
  });
  const generator = fakeGenerator(opts.reply ?? "Hi there");
  const bot = createPersona({
    persona: persona(),
    channel: client,
    generator,
    describer: opts.describer,
    logger: silentLogger,
    policy: { direct: "always" },
  });
  const webhook = createCloudApiWebhook({
    bot,
    appSecret: APP_SECRET,
    verifyToken: VERIFY_TOKEN,
    phoneNumberId: PHONE_ID,
    downloadMedia: opts.downloadMedia,
  });
  const post = (
    body: string,
    signature = sign(body, APP_SECRET),
    ctx?: ExecutionContextLike,
  ) =>
    webhook(
      new Request("https://bot.test/webhook/whatsapp", {
        method: "POST",
        headers: {
          "x-hub-signature-256": signature,
          "content-type": "application/json",
        },
        body,
      }),
      ctx,
    );
  return { webhook, post, graphCalls, generator, bot };
}

describe("webhook verification (GET)", () => {
  it("echoes the challenge when the verify token matches", async () => {
    const { webhook } = stack();

    const res = await webhook(
      new Request(
        `https://bot.test/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=4242`,
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("4242");
  });

  it("rejects a wrong verify token", async () => {
    const { webhook } = stack();

    const res = await webhook(
      new Request(
        "https://bot.test/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=4242",
      ),
    );

    expect(res.status).toBe(403);
  });

  it("answers 405 for methods other than GET and POST", async () => {
    const { webhook } = stack();

    const res = await webhook(
      new Request("https://bot.test/webhook/whatsapp", { method: "PUT" }),
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
      `https://graph.facebook.com/v22.0/${PHONE_ID}/messages`,
    );
    const sent = JSON.parse(String(graphCalls[0]?.init.body));
    expect(sent).toMatchObject({
      messaging_product: "whatsapp",
      to: "5511888888888",
      type: "text",
      text: { body: "Hi there" },
      context: { message_id: "wamid.1" },
    });
  });

  it("sends the Graph API bearer token", async () => {
    const { post, graphCalls } = stack();

    await post(cloudPayload([textMessage("wamid.1", "5511888888888", "oi")]));

    const headers = graphCalls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer graph-token");
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
        method: "POST",
        body: cloudPayload([textMessage("wamid.1", "5511888888888", "oi")]),
      }),
    );

    expect(res.status).toBe(403);
  });

  it("ignores messages sent to a different phone number id", async () => {
    const { post, graphCalls, generator } = stack();
    const body = cloudPayload(
      [textMessage("wamid.1", "5511888888888", "oi")],
      "SOMEONE_ELSE",
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
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_1",
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
        },
      ],
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
      downloadMedia: async (id, maxBytes) => {
        downloads.push({ id, maxBytes });
        return JPEG;
      },
    });
    const body = cloudPayload([
      {
        from: "5511888888888",
        id: "wamid.img",
        timestamp: "1700000000",
        type: "image",
        image: {
          id: "MEDIA_9",
          mime_type: "image/jpeg",
          caption: "look at this",
        },
      },
    ]);

    await post(body);

    expect(downloads).toEqual([{ id: "MEDIA_9", maxBytes: 5 * 1024 * 1024 }]);
    expect(describer.seen).toEqual([
      { bytes: JPEG.byteLength, mime: "image/jpeg" },
    ]);
    expect(generator.calls[0]?.messages.at(-1)?.content).toBe(
      "look at this [image: a sunset over the sea]",
    );
  });

  it("drops a sticker that is not WebP before it reaches the model", async () => {
    const describer = fakeDescriber();
    const { post, generator } = stack({
      describer,
      downloadMedia: async () => JPEG,
    });
    const body = cloudPayload([
      {
        from: "5511888888888",
        id: "wamid.st",
        timestamp: "1700000000",
        type: "sticker",
        sticker: { id: "MEDIA_3", mime_type: "image/webp" },
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
      downloadMedia: async () => WEBP,
    });
    const body = cloudPayload([
      {
        from: "5511888888888",
        id: "wamid.st",
        timestamp: "1700000000",
        type: "sticker",
        sticker: { id: "MEDIA_3", mime_type: "image/webp" },
      },
    ]);

    await post(body);

    expect(generator.calls[0]?.messages.at(-1)?.content).toBe(
      " [sticker: a waving cat]",
    );
  });

  it("still answers the caption when the image download fails", async () => {
    const { post, generator } = stack({
      downloadMedia: async () => {
        throw new Error("graph 500");
      },
    });
    const body = cloudPayload([
      {
        from: "5511888888888",
        id: "wamid.img",
        timestamp: "1700000000",
        type: "image",
        image: {
          id: "MEDIA_9",
          mime_type: "image/jpeg",
          caption: "look at this",
        },
      },
    ]);

    await post(body);

    expect(generator.calls[0]?.messages.at(-1)?.content).toBe("look at this");
  });

  it("hands the work to waitUntil when a Workers context is present", async () => {
    const { post, graphCalls } = stack();
    const pending: Promise<unknown>[] = [];
    const ctx: ExecutionContextLike = {
      waitUntil: (p) => {
        pending.push(p);
      },
    };

    const res = await post(
      cloudPayload([textMessage("wamid.1", "5511888888888", "oi")]),
      undefined,
      ctx,
    );

    expect(res.status).toBe(200);
    expect(pending).toHaveLength(1);
    expect(graphCalls).toHaveLength(0);
    await Promise.all(pending);
    expect(graphCalls).toHaveLength(1);
  });
});
