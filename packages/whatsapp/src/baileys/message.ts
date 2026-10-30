import type { IncomingMessage } from "@persona/core";
import { downloadMediaMessage, type WAMessage, type WASocket } from "baileys";
import { isWebp } from "../media";

const MAX_STICKER_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface StickerInput {
  download: () => Promise<Uint8Array>;
}

export interface ToIncomingOpts {
  includeImages?: boolean | undefined;
  senderId?: string | undefined;
}

export function userPart(jid: string): string {
  const parts = jid.split("@");
  return (parts[0] ?? "").split(":")[0] ?? "";
}

async function downloadMedia(
  msg: WAMessage,
  sock: WASocket,
): Promise<Uint8Array> {
  const buf = await downloadMediaMessage(
    msg,
    "buffer",
    {},
    {
      logger: sock.logger,
      reuploadRequest: sock.updateMediaMessage,
    },
  );
  return new Uint8Array(buf);
}

/** Downloads media and drops it when it is too large or not the expected type. */
async function fetchMedia(
  msg: WAMessage,
  sock: WASocket,
  kind: "image" | "sticker",
): Promise<Uint8Array | undefined> {
  const maxBytes = kind === "sticker" ? MAX_STICKER_BYTES : MAX_IMAGE_BYTES;
  try {
    const data = await downloadMedia(msg, sock);
    if (data.byteLength > maxBytes) return undefined;
    if (kind === "sticker" && !isWebp(data)) return undefined;
    return data;
  } catch {
    return undefined;
  }
}

export async function toIncoming(
  sock: WASocket,
  msg: WAMessage,
  opts: ToIncomingOpts = {},
): Promise<IncomingMessage | undefined> {
  const content = msg.message;
  const jid = msg.key.remoteJid;
  if (!(content && jid) || msg.key.fromMe) return undefined;

  const isGroup = jid.endsWith("@g.us");
  if (!isGroup && !jid.endsWith("@s.whatsapp.net") && !jid.endsWith("@lid")) {
    return undefined;
  }

  const sticker = content.stickerMessage;
  if (
    sticker &&
    (sticker.mimetype !== "image/webp" ||
      (Number(sticker.fileLength) ?? 0) > MAX_STICKER_BYTES)
  ) {
    return undefined;
  }

  const text =
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    "";
  const media: NonNullable<IncomingMessage["media"]> = [];
  if (sticker) {
    const data = await fetchMedia(msg, sock, "sticker");
    if (data) media.push({ kind: "sticker", data, mime: "image/webp" });
  }
  if (opts.includeImages && content.imageMessage) {
    const data = await fetchMedia(msg, sock, "image");
    if (data) {
      media.push({
        kind: "image",
        data,
        mime: content.imageMessage.mimetype ?? "image/jpeg",
      });
    }
  }
  if (!text && media.length === 0) return undefined;

  const ctx = content.extendedTextMessage?.contextInfo;
  const mentions = ctx?.mentionedJid ?? [];
  const self = [sock.user?.id, sock.user?.lid]
    .filter((x): x is string => Boolean(x))
    .map(userPart);
  const mentionsBot = mentions.some((m) => self.includes(userPart(m)));
  const repliesToBot = Boolean(
    ctx?.participant && self.includes(userPart(ctx.participant)),
  );
  const participant = msg.key.participant || jid;

  return {
    id: msg.key.id ?? "",
    chatId: jid,
    text,
    senderName: msg.pushName ?? userPart(participant),
    isGroup,
    media,
    mentionsBot,
    repliesToBot,
  };
}
