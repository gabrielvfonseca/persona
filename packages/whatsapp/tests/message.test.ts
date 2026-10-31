import type { WAMessage, WASocket } from "baileys";
import { describe, expect, it, vi } from "vitest";
import { toIncoming, userPart } from "../../src/baileys/message";
import { isWebp } from "../../src/media";

vi.mock("baileys", async (orig) => ({
  ...(await orig<typeof import("baileys")>()),
  downloadMediaMessage: vi.fn(async () => Buffer.from("RIFF\0\0\0\0WEBPVP8 ")),
}));

const BOT = {
  user: { id: "5511999000001:3@s.whatsapp.net", lid: "123456789:3@lid" },
} as unknown as WASocket;

function makeMsg(overrides: Partial<WAMessage> = {}): WAMessage {
  return {
    key: { fromMe: false, id: "M1", remoteJid: "5511888000002@s.whatsapp.net" },
    message: { conversation: "hello" },
    ...overrides,
  } as WAMessage;
}

describe("toIncoming", () => {
  it("parses a direct message", async () => {
    const sock = BOT;
    const msg = await toIncoming(sock, makeMsg());
    expect(msg?.chatId).toBe("5511888000002@s.whatsapp.net");
    expect(msg?.isGroup).toBe(false);
    expect(msg?.text).toBe("hello");
    expect(msg?.senderName).toBe("5511888000002");
  });
  it("ignores fromMe messages", async () => {
    const sock = BOT;
    const msg = await toIncoming(
      sock,
      makeMsg({
        key: {
          fromMe: true,
          id: "M2",
          remoteJid: "5511888000002@s.whatsapp.net",
        },
      }),
    );
    expect(msg).toBeUndefined();
  });
  it("detects mentions by phone", async () => {
    const sock = BOT;
    const msg = await toIncoming(
      sock,
      makeMsg({
        key: { fromMe: false, id: "M2", remoteJid: "120363000000000000@g.us" },
        message: {
          extendedTextMessage: {
            text: "@persona hi",
            contextInfo: { mentionedJid: ["5511999000001@s.whatsapp.net"] },
          },
        },
      }),
    );
    expect(msg?.isGroup).toBe(true);
    expect(msg?.mentionsBot).toBe(true);
  });
  it("detects mentions by LID", async () => {
    const sock = BOT;
    const msg = await toIncoming(
      sock,
      makeMsg({
        key: { fromMe: false, id: "M3", remoteJid: "120363000000000000@g.us" },
        message: {
          extendedTextMessage: {
            text: "@persona hi",
            contextInfo: { mentionedJid: ["123456789@lid"] },
          },
        },
      }),
    );
    expect(msg?.mentionsBot).toBe(true);
  });
  it("extracts image captions", async () => {
    const sock = BOT;
    const msg = await toIncoming(
      sock,
      makeMsg({
        message: { imageMessage: { caption: "look at this" } },
      }),
    );
    expect(msg?.text).toBe("look at this");
  });
});

describe("userPart", () => {
  it("extracts user from JID", async () => {
    expect(userPart("5511999000001:3@s.whatsapp.net")).toBe("5511999000001");
    expect(userPart("123456789:3@lid")).toBe("123456789");
    expect(userPart("5511888000002@s.whatsapp.net")).toBe("5511888000002");
  });
});

describe("isWebp", () => {
  it("accepts RIFF/WEBP header", async () => {
    const buf = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
    expect(isWebp(buf)).toBe(true);
  });
  it("rejects non-WebP", async () => {
    const buf = new Uint8Array([137, 80, 78, 71]);
    expect(isWebp(buf)).toBe(false);
    expect(isWebp(new Uint8Array([82, 73, 70, 70]))).toBe(false);
  });
  it("keeps a valid WebP sticker as media", async () => {
    const msg = await toIncoming(
      BOT,
      makeMsg({
        message: {
          stickerMessage: { mimetype: "image/webp", fileLength: 1000 },
        } as NonNullable<WAMessage["message"]>,
      }),
    );
    expect(msg?.media?.[0]?.kind).toBe("sticker");
    expect(msg?.media?.[0]?.mime).toBe("image/webp");
  });
  it("drops a sticker whose bytes are not WebP", async () => {
    const { downloadMediaMessage } = await import("baileys");
    vi.mocked(downloadMediaMessage).mockResolvedValueOnce(
      Buffer.from("not an image at all"),
    );
    const msg = await toIncoming(
      BOT,
      makeMsg({
        message: {
          stickerMessage: { mimetype: "image/webp", fileLength: 1000 },
        } as NonNullable<WAMessage["message"]>,
      }),
    );
    expect(msg).toBeUndefined();
  });
  it("omits an image larger than the limit but keeps its caption", async () => {
    const { downloadMediaMessage } = await import("baileys");
    vi.mocked(downloadMediaMessage).mockResolvedValueOnce(
      Buffer.alloc(6 * 1024 * 1024),
    );
    const msg = await toIncoming(
      BOT,
      makeMsg({
        message: {
          imageMessage: { caption: "look", mimetype: "image/png" },
        } as NonNullable<WAMessage["message"]>,
      }),
      { includeImages: true },
    );
    expect(msg?.text).toBe("look");
    expect(msg?.media).toEqual([]);
  });
});
