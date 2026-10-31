import { createHmac } from "node:crypto";
import type {
  Channel,
  DedupeStore,
  HistoryStore,
  ImageDescriber,
  Logger,
  ReplyGenerator,
  Turn,
} from "@persona/core";
import type { KVStorage } from "@persona/kv";
import { type Persona, parsePersona } from "@persona/schemas";
import examplePersona from "../../examples/bot/data/persona.example.json";

/** The persona shipped in examples/bot. Validated once, shared read-only. */
export const persona = (): Persona =>
  parsePersona(structuredClone(examplePersona));

/** Records every send. Optionally throws to simulate a transport failure. */
export function fakeChannel(opts: { fail?: boolean } = {}) {
  const sent: { chatId: string; text: string; replyTo?: string | undefined }[] =
    [];
  const channel: Channel & { sent: typeof sent } = {
    name: "fake",
    sent,
    async send(chatId, text, replyTo) {
      if (opts.fail) throw new Error("transport down");
      sent.push({ chatId, text, replyTo });
    },
  };
  return channel;
}

/** Returns a fixed reply and records every call it receives. */
export function fakeGenerator(
  reply: string | ((turns: Turn[]) => string) = "ok",
) {
  const calls: { system: string; messages: Turn[] }[] = [];
  const generator: ReplyGenerator & { calls: typeof calls } = {
    calls,
    async generate(system, messages) {
      calls.push({ system, messages: structuredClone(messages) });
      return typeof reply === "function" ? reply(messages) : reply;
    },
  };
  return generator;
}

export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** A plain Map-backed KV with the same surface as Workers KV. */
export function memoryKv() {
  const data = new Map<string, string>();
  const puts: { key: string; ttl?: number | undefined }[] = [];
  const kv: KVStorage & { data: Map<string, string>; puts: typeof puts } = {
    data,
    puts,
    async get(key) {
      return data.get(key) ?? null;
    },
    async put(key, value, opts) {
      puts.push({ key, ttl: opts?.expirationTtl });
      data.set(key, value);
    },
    async delete(key) {
      data.delete(key);
    },
  };
  return kv;
}

/** An in-process history store, for tests that do not care about storage. */
export function memoryHistory(): HistoryStore & { turns: Map<string, Turn[]> } {
  const turns = new Map<string, Turn[]>();
  return {
    turns,
    async load(chatId) {
      return [...(turns.get(chatId) ?? [])];
    },
    async append(chatId, added) {
      turns.set(chatId, [...(turns.get(chatId) ?? []), ...added]);
    },
  };
}

export const noDedupe: DedupeStore = {
  async has() {
    return false;
  },
  async set() {},
};

/** Describes images as "a red bike" and records what it was given. */
export function fakeDescriber(description = "a red bike") {
  const seen: { bytes: number; mime: string }[] = [];
  const describer: ImageDescriber & { seen: typeof seen } = {
    seen,
    async describe(data, mime) {
      seen.push({ bytes: data.byteLength, mime });
      return description;
    },
  };
  return describer;
}

/** The X-Hub-Signature-256 value Meta sends for a raw body. */
export function sign(body: string, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`;
}

/** A WhatsApp Cloud API webhook body with one or more inbound messages. */
export function cloudPayload(
  messages: Record<string, unknown>[],
  phoneNumberId = "PHONE_1",
): string {
  return JSON.stringify({
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
                display_phone_number: "5511000000000",
                phone_number_id: phoneNumberId,
              },
              messages,
            },
          },
        ],
      },
    ],
  });
}

export function textMessage(id: string, from: string, body: string) {
  return {
    from,
    id,
    timestamp: "1700000000",
    type: "text",
    text: { body },
  };
}
