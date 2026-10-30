import { describe, expect, it } from "vitest";
import { CloudApiClient } from "../../src/cloud/client";
import { extractMessages } from "../../src/cloud/payload";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });

function fakeFetch(routes: Record<string, () => Response>) {
  const calls: { url: string; auth: string | null }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
    const route = routes[url];
    if (!route) return new Response("no route", { status: 404 });
    return route();
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("CloudApiClient.downloadMedia", () => {
  it("looks up the url, then fetches the file with the token", async () => {
    const { fetch, calls } = fakeFetch({
      "https://graph.facebook.com/v22.0/m1": () =>
        json({ url: "https://files.example/m1", file_size: 3 }),
      "https://files.example/m1": () => new Response(new Uint8Array([1, 2, 3])),
    });
    const client = new CloudApiClient({
      phoneNumberId: "1",
      accessToken: "tok",
      fetch,
    });
    const bytes = await client.downloadMedia("m1", 100);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(calls.every((c) => c.auth === "Bearer tok")).toBe(true);
  });

  it("refuses a file declared larger than the limit", async () => {
    const { fetch } = fakeFetch({
      "https://graph.facebook.com/v22.0/big": () =>
        json({ url: "https://files.example/big", file_size: 999 }),
    });
    const client = new CloudApiClient({
      phoneNumberId: "1",
      accessToken: "tok",
      fetch,
    });
    await expect(client.downloadMedia("big", 10)).rejects.toMatchObject({
      status: 413,
    });
  });

  it("refuses a file that is larger than declared", async () => {
    const { fetch } = fakeFetch({
      "https://graph.facebook.com/v22.0/x": () =>
        json({ url: "https://files.example/x" }),
      "https://files.example/x": () => new Response(new Uint8Array(50)),
    });
    const client = new CloudApiClient({
      phoneNumberId: "1",
      accessToken: "tok",
      fetch,
    });
    await expect(client.downloadMedia("x", 10)).rejects.toMatchObject({
      status: 413,
    });
  });
});

const wrap = (messages: unknown[]) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "e",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "1", phone_number_id: "101" },
            messages,
          },
        },
      ],
    },
  ],
});

describe("extractMessages media", () => {
  it("reads an image with its caption as text", () => {
    const [msg] = extractMessages(
      wrap([
        {
          from: "5511",
          id: "m1",
          timestamp: "1",
          type: "image",
          image: { id: "img-1", mime_type: "image/jpeg", caption: "look" },
        },
      ]),
      "101",
    );
    expect(msg).toMatchObject({
      text: "look",
      media: { kind: "image", mediaId: "img-1", mime: "image/jpeg" },
    });
  });

  it("reads a sticker with no text", () => {
    const [msg] = extractMessages(
      wrap([
        {
          from: "5511",
          id: "m2",
          timestamp: "1",
          type: "sticker",
          sticker: { id: "st-1", mime_type: "image/webp" },
        },
      ]),
      "101",
    );
    expect(msg).toMatchObject({
      text: "",
      media: { kind: "sticker", mediaId: "st-1" },
    });
  });
});
