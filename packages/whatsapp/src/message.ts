import type { IncomingMessage } from "@persona/core";
import { downloadMediaMessage, type WAMessage, type WASocket } from "baileys";
import type { GroupSizeLookup } from "./groups";
import { isWebp } from "./media";

const MAX_STICKER_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface StickerInput {
  download: () => Promise<Uint8Array>;
}

export interface ToIncomingOpts {
  /** Fills `participantCount` for group messages, so learning can tell group sizes apart. */
  groupSize?: GroupSizeLookup | undefined;
  includeImages?: boolean | undefined;
  senderId?: string | undefined;
}

export function userPart(jid: string): string {
  const parts = jid.split("@");
  return (parts[0] ?? "").split(":")[0] ?? "";
}

/** The socket fields a message parser reads. A Baileys socket satisfies this. */
export type MessageSocket = Pick<WASocket, "user"> &
  Partial<Pick<WASocket, "logger" | "updateMediaMessage">>;

/** Used when the socket has no logger, so media downloads stay quiet. */
const SILENT_LOGGER: NonNullable<WASocket["logger"]> = {
  child() {
    return SILENT_LOGGER;
  },
  debug() {
    /* intentionally empty */
  },
  error() {
    /* intentionally empty */
  },
  info() {
    /* intentionally empty */
  },
  level: "silent",
  trace() {
    /* intentionally empty */
  },
  warn() {
    /* intentionally empty */
  },
};

async function downloadMedia(
  msg: WAMessage,
  sock: MessageSocket
): Promise<Uint8Array> {
  if (!sock.updateMediaMessage) {
    throw new Error("this socket cannot download media");
  }
  const buf = await downloadMediaMessage(
    msg,
    "buffer",
    {},
    {
      logger: sock.logger ?? SILENT_LOGGER,
      reuploadRequest: sock.updateMediaMessage,
    }
  );
  return new Uint8Array(buf);
}

/** Downloads media and drops it when it is too large or not the expected type. */
async function fetchMedia(
  msg: WAMessage,
  sock: MessageSocket,
  kind: "image" | "sticker"
): Promise<Uint8Array | undefined> {
  const maxBytes = kind === "sticker" ? MAX_STICKER_BYTES : MAX_IMAGE_BYTES;
  try {
    const data = await downloadMedia(msg, sock);
    if (data.byteLength > maxBytes) {
      return undefined;
    }
    if (kind === "sticker" && !isWebp(data)) {
      return undefined;
    }
    return data;
  } catch {
    return undefined;
  }
}

type MessageContent = NonNullable<WAMessage["message"]>;
type Sticker = NonNullable<MessageContent["stickerMessage"]>;

/** Stickers must be WebP and within the size limit. */
function isAcceptableSticker(sticker: Sticker): boolean {
  return (
    sticker.mimetype === "image/webp" &&
    !(Number(sticker.fileLength) > MAX_STICKER_BYTES)
  );
}

/** Downloads the sticker and, when asked, the image. Anything too large or unreadable is left out. */
async function collectMedia(
  msg: WAMessage,
  sock: MessageSocket,
  content: MessageContent,
  opts: ToIncomingOpts
): Promise<NonNullable<IncomingMessage["media"]>> {
  const media: NonNullable<IncomingMessage["media"]> = [];
  if (content.stickerMessage) {
    const data = await fetchMedia(msg, sock, "sticker");
    if (data) {
      media.push({ data, kind: "sticker", mime: "image/webp" });
    }
  }
  if (opts.includeImages && content.imageMessage) {
    const data = await fetchMedia(msg, sock, "image");
    if (data) {
      media.push({
        data,
        kind: "image",
        mime: content.imageMessage.mimetype ?? "image/jpeg",
      });
    }
  }
  return media;
}

export async function toIncoming(
  sock: MessageSocket,
  msg: WAMessage,
  opts: ToIncomingOpts = {}
): Promise<IncomingMessage | undefined> {
  const content = msg.message;
  const jid = msg.key.remoteJid;
  if (!(content && jid) || msg.key.fromMe) {
    return undefined;
  }

  const isGroup = jid.endsWith("@g.us");
  if (!(isGroup || jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid"))) {
    return undefined;
  }

  const sticker = content.stickerMessage;
  if (sticker && !isAcceptableSticker(sticker)) {
    return undefined;
  }

  const text =
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    "";
  const media = await collectMedia(msg, sock, content, opts);
  if (!text && media.length === 0) {
    return undefined;
  }

  const ctx = content.extendedTextMessage?.contextInfo;
  const mentions = ctx?.mentionedJid ?? [];
  const self = [sock.user?.id, sock.user?.lid]
    .filter((x): x is string => Boolean(x))
    .map(userPart);
  const mentionsBot = mentions.some((m) => self.includes(userPart(m)));
  const repliesToBot = Boolean(
    ctx?.participant && self.includes(userPart(ctx.participant))
  );
  const participant = msg.key.participant || jid;
  const participantCount =
    isGroup && opts.groupSize ? await opts.groupSize(jid) : undefined;

  return {
    chatId: jid,
    id: msg.key.id ?? "",
    isGroup,
    media,
    mentionsBot,
    participantCount,
    repliesToBot,
    senderName: msg.pushName ?? userPart(participant),
    text,
  };
}
