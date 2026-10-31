import type { Channel } from "@persona/core";

export class CloudApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "CloudApiError";
  }
}

export interface CloudApiClientOpts {
  phoneNumberId: string;
  accessToken: string;
  graphVersion?: string | undefined;
  fetch?: typeof fetch | undefined;
}

export class CloudApiClient implements Channel {
  readonly name = "cloud-api";
  private readonly phoneNumberId: string;
  private readonly accessToken: string;
  private readonly graphVersion: string;
  private readonly fetch: typeof fetch;

  constructor(opts: CloudApiClientOpts) {
    this.phoneNumberId = opts.phoneNumberId;
    this.accessToken = opts.accessToken;
    this.graphVersion = opts.graphVersion ?? "v22.0";
    this.fetch = opts.fetch ?? fetch;
  }

  async send(chatId: string, text: string, replyTo?: string): Promise<void> {
    const url = `https://graph.facebook.com/${this.graphVersion}/${this.phoneNumberId}/messages`;
    const body: Record<string, unknown> = {
      messaging_product: "whatsapp",
      to: chatId,
      type: "text",
      text: { body: text },
    };
    if (replyTo) body.context = { message_id: replyTo };

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
      throw new CloudApiError(
        res.status,
        `WhatsApp send failed: ${res.statusText}`,
        bodyText,
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
      { headers: auth },
    );
    if (!metaRes.ok) {
      throw new CloudApiError(
        metaRes.status,
        `Media lookup failed: ${metaRes.statusText}`,
      );
    }
    const meta = (await metaRes.json()) as {
      url?: unknown | undefined;
      file_size?: unknown | undefined;
    };
    if (typeof meta.url !== "string") {
      throw new CloudApiError(502, "Media lookup returned no url");
    }
    if (typeof meta.file_size === "number" && meta.file_size > maxBytes) {
      throw new CloudApiError(413, "Media is larger than the limit");
    }

    const fileRes = await this.fetch(meta.url, { headers: auth });
    if (!fileRes.ok) {
      throw new CloudApiError(
        fileRes.status,
        `Media download failed: ${fileRes.statusText}`,
      );
    }
    const bytes = new Uint8Array(await fileRes.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new CloudApiError(413, "Media is larger than the limit");
    }
    return bytes;
  }
}
