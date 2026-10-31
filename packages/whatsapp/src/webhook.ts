import { verifyWhatsAppChallenge } from "@openchannelprotocol/sdk/whatsapp";
import type { IncomingMessage, MessageHandler } from "@persona/core";
import { isWebp } from "./media";
import { extractMessages, type MediaRef } from "./payload";
import { isValidSignature } from "./signature";

export interface WhatsappWebhookOpts {
  appSecret: string;
  bot: MessageHandler;
  /** Fetches media by id. Without it, media messages are passed on as text only. */
  downloadMedia?:
    | ((id: string, maxBytes: number) => Promise<Uint8Array>)
    | undefined;
  phoneNumberId: string;
  verifyToken: string;
}

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const STICKER_MAX_BYTES = 1024 * 1024;

/**
 * Keeps work running after the response is sent. A Workers `ExecutionContext` fits,
 * as does any object with `waitUntil`. Without one, the webhook awaits the work.
 */
export interface BackgroundTasks {
  waitUntil: (promise: Promise<unknown>) => void;
}

export function createWhatsappWebhook(opts: WhatsappWebhookOpts) {
  const { bot, appSecret, verifyToken, phoneNumberId } = opts;

  function verifyChallenge(
    mode: string,
    token: string,
    challenge: string
  ): string | null {
    try {
      return verifyWhatsAppChallenge(mode, token, challenge, verifyToken);
    } catch {
      return null;
    }
  }

  async function fetchMedia(
    ref: MediaRef | undefined
  ): Promise<IncomingMessage["media"]> {
    if (!(ref && opts.downloadMedia)) {
      return undefined;
    }
    const maxBytes =
      ref.kind === "sticker" ? STICKER_MAX_BYTES : IMAGE_MAX_BYTES;
    try {
      const data = await opts.downloadMedia(ref.mediaId, maxBytes);
      if (ref.kind === "sticker" && !isWebp(data)) {
        return undefined;
      }
      return [{ data, kind: ref.kind, mime: ref.mime }];
    } catch {
      // Lost media is not worth a failed reply: answer the text, if any.
      return undefined;
    }
  }

  async function handlePost(
    raw: string,
    headers: Headers,
    ctx?: BackgroundTasks
  ): Promise<Response> {
    if (!isValidSignature(raw, headers.get("x-hub-signature-256"), appSecret)) {
      return new Response("forbidden", { status: 403 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return new Response("OK");
    }

    const messages = extractMessages(payload, phoneNumberId);
    if (messages.length === 0) {
      return new Response("OK");
    }

    const work = (async () => {
      for (const msg of messages) {
        // biome-ignore lint/performance/noAwaitInLoops: messages are handled in the order they arrive
        const media = await fetchMedia(msg.media);
        if (msg.text || media) {
          await bot.handle({
            chatId: msg.from,
            id: msg.id,
            isGroup: false,
            media,
            senderName: undefined,
            text: msg.text,
          });
        }
      }
    })();

    // Meta retries any webhook that takes too long, so answer first and let the
    // model run in the background when the runtime allows it.
    if (ctx) {
      ctx.waitUntil(work);
    } else {
      await work;
    }

    return new Response("OK");
  }

  return async (req: Request, ctx?: BackgroundTasks): Promise<Response> => {
    if (req.method === "GET") {
      const mode = new URL(req.url).searchParams.get("hub.mode") ?? "";
      const token = new URL(req.url).searchParams.get("hub.verify_token") ?? "";
      const challenge =
        new URL(req.url).searchParams.get("hub.challenge") ?? "";
      const result = verifyChallenge(mode, token, challenge);
      if (result === null) {
        return new Response("forbidden", { status: 403 });
      }
      return new Response(result);
    }

    if (req.method === "POST") {
      const raw = await req.text();
      return handlePost(raw, req.headers, ctx);
    }

    return new Response("method not allowed", { status: 405 });
  };
}
