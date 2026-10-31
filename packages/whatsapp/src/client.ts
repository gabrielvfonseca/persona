import type { Channel } from "@persona/core";

/** The part of `fetch` the client uses. The global `fetch` and test stubs both satisfy it. */
export type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export class WhatsappError extends Error {
  readonly status: number;
  readonly body?: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
    this.name = "WhatsappError";
  }
}

export interface WhatsappClientOpts {
  accessToken: string;
  fetch?: FetchLike | undefined;
  graphVersion?: string | undefined;
  phoneNumberId: string;
}

export class WhatsappClient implements Channel {
  readonly name = "whatsapp";
  private readonly phoneNumberId: string;
  private readonly accessToken: string;
  private readonly graphVersion: string;
  private readonly fetch: FetchLike;

  constructor(opts: WhatsappClientOpts) {
    this.phoneNumberId = opts.phoneNumberId;
    this.accessToken = opts.accessToken;
    this.graphVersion = opts.graphVersion ?? "v22.0";
    this.fetch = opts.fetch ?? fetch;
  }

  async send(chatId: string, text: string, replyTo?: string): Promise<void> {
    const url = `https://graph.facebook.com/${this.graphVersion}/${this.phoneNumberId}/messages`;
    const body: Record<string, unknown> = {
      messaging_product: "whatsapp",
      text: { body: text },
      to: chatId,
      type: "text",
    };
    if (replyTo) {
      body.context = { message_id: replyTo };
    }

    const res = await this.fetch(url, {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!res.ok) {
      let bodyText: unknown;
      try {
        bodyText = await res.text();
      } catch {
        bodyText = undefined;
      }
      throw new WhatsappError(
        res.status,
        `WhatsApp send failed: ${res.statusText}`,
        bodyText
      );
    }
  }

  async markRead(chatId: string): Promise<void> {
    const url = `https://graph.facebook.com/${this.graphVersion}/${this.phoneNumberId}/messages`;
    await this.fetch(url, {
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        to: chatId,
      }),
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  }

  /**
   * Downloads media in two steps: the Graph API returns a short-lived `url`,
   * which is then fetched with the same token. Throws when the file is larger
   * than `maxBytes`, either declared in the metadata or actually received.
   */
  async downloadMedia(id: string, maxBytes: number): Promise<Uint8Array> {
    const auth = { Authorization: `Bearer ${this.accessToken}` };
    const metaRes = await this.fetch(
      `https://graph.facebook.com/${this.graphVersion}/${id}`,
      { headers: auth }
    );
    if (!metaRes.ok) {
      throw new WhatsappError(
        metaRes.status,
        `Media lookup failed: ${metaRes.statusText}`
      );
    }
    const meta = (await metaRes.json()) as {
      url?: unknown | undefined;
      file_size?: unknown | undefined;
    };
    if (typeof meta.url !== "string") {
      throw new WhatsappError(502, "Media lookup returned no url");
    }
    if (typeof meta.file_size === "number" && meta.file_size > maxBytes) {
      throw new WhatsappError(413, "Media is larger than the limit");
    }

    const fileRes = await this.fetch(meta.url, { headers: auth });
    if (!fileRes.ok) {
      throw new WhatsappError(
        fileRes.status,
        `Media download failed: ${fileRes.statusText}`
      );
    }
    const bytes = new Uint8Array(await fileRes.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new WhatsappError(413, "Media is larger than the limit");
    }
    return bytes;
  }
}
