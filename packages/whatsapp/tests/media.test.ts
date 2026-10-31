import { describe, expect, it } from "vitest";
import { WhatsappClient } from "../src/client";
import { extractMessages } from "../src/payload";

const json = (body: unknown) => Response.json(body);

function fakeFetch(routes: Record<string, () => Response>) {
  const calls: { url: string; auth: string | null }[] = [];
  const fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ auth: new Headers(init?.headers).get("authorization"), url });
    const route = routes[url];
    if (!route) {
      return Promise.resolve(new Response("no route", { status: 404 }));
    }
    return Promise.resolve(route());
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

describe("WhatsappClient.downloadMedia", () => {
  it("looks up the url, then fetches the file with the token", async () => {
    const { fetch, calls } = fakeFetch({
      "https://files.example/m1": () => new Response(new Uint8Array([1, 2, 3])),
      "https://graph.facebook.com/v22.0/m1": () =>
        json({ file_size: 3, url: "https://files.example/m1" }),
    });
    const client = new WhatsappClient({
      accessToken: "tok",
      fetch,
      phoneNumberId: "1",
    });
    const bytes = await client.downloadMedia("m1", 100);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(calls.every((c) => c.auth === "Bearer tok")).toBe(true);
  });

  it("refuses a file declared larger than the limit", async () => {
    const { fetch } = fakeFetch({
      "https://graph.facebook.com/v22.0/big": () =>
        json({ file_size: 999, url: "https://files.example/big" }),
    });
    const client = new WhatsappClient({
      accessToken: "tok",
      fetch,
      phoneNumberId: "1",
    });
    await expect(client.downloadMedia("big", 10)).rejects.toMatchObject({
      status: 413,
    });
  });

  it("refuses a file that is larger than declared", async () => {
    const { fetch } = fakeFetch({
      "https://files.example/x": () => new Response(new Uint8Array(50)),
      "https://graph.facebook.com/v22.0/x": () =>
        json({ url: "https://files.example/x" }),
    });
    const client = new WhatsappClient({
      accessToken: "tok",
      fetch,
      phoneNumberId: "1",
    });
    await expect(client.downloadMedia("x", 10)).rejects.toMatchObject({
      status: 413,
    });
  });
});

const wrap = (messages: unknown[]) => ({
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: {
            messages,
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "1", phone_number_id: "101" },
          },
        },
      ],
      id: "e",
    },
  ],
  object: "whatsapp_business_account",
});

describe("extractMessages media", () => {
  it("reads an image with its caption as text", () => {
    const [msg] = extractMessages(
      wrap([
        {
          from: "5511",
          id: "m1",
          image: { caption: "look", id: "img-1", mime_type: "image/jpeg" },
          timestamp: "1",
          type: "image",
        },
      ]),
      "101"
    );
    expect(msg).toMatchObject({
      media: { kind: "image", mediaId: "img-1", mime: "image/jpeg" },
      text: "look",
    });
  });

  it("reads a sticker with no text", () => {
    const [msg] = extractMessages(
      wrap([
        {
          from: "5511",
          id: "m2",
          sticker: { id: "st-1", mime_type: "image/webp" },
          timestamp: "1",
          type: "sticker",
        },
      ]),
      "101"
    );
    expect(msg).toMatchObject({
      media: { kind: "sticker", mediaId: "st-1" },
      text: "",
    });
  });
});
