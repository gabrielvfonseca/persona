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
import type { KVStorage } from "@persona/postgres";
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
    send(chatId, text, replyTo) {
      if (opts.fail) {
        return Promise.reject(new Error("transport down"));
      }
      sent.push({ chatId, replyTo, text });
      return Promise.resolve();
    },
    sent,
  };
  return channel;
}

/** Returns a fixed reply and records every call it receives. */
/** A reply generator that records its calls. A function reply may throw to simulate a model failure. */
export function fakeGenerator(
  reply: string | ((turns: Turn[]) => string) = "ok"
) {
  const calls: { system: string; messages: Turn[] }[] = [];
  const generator: ReplyGenerator & { calls: typeof calls } = {
    calls,
    generate(system, messages) {
      calls.push({ messages: structuredClone(messages), system });
      return Promise.resolve(
        typeof reply === "function" ? reply(messages) : reply
      );
    },
  };
  return generator;
}

export const silentLogger: Logger = {
  error: () => {
    /* intentionally empty */
  },
  info: () => {
    /* intentionally empty */
  },
  warn: () => {
    /* intentionally empty */
  },
};

/** A plain Map-backed KV with the same surface as Workers KV. */
export function memoryKv() {
  const data = new Map<string, string>();
  const puts: { key: string; ttl?: number | undefined }[] = [];
  const kv: KVStorage & { data: Map<string, string>; puts: typeof puts } = {
    data,
    delete(key) {
      data.delete(key);
      return Promise.resolve();
    },
    get(key) {
      return Promise.resolve(data.get(key) ?? null);
    },
    put(key, value, opts) {
      puts.push({ key, ttl: opts?.expirationTtl });
      data.set(key, value);
      return Promise.resolve();
    },
    puts,
  };
  return kv;
}

/** An in-process history store, for tests that do not care about storage. */
export function memoryHistory(): HistoryStore & { turns: Map<string, Turn[]> } {
  const turns = new Map<string, Turn[]>();
  return {
    append(chatId, added) {
      turns.set(chatId, [...(turns.get(chatId) ?? []), ...added]);
      return Promise.resolve();
    },
    load(chatId) {
      return Promise.resolve([...(turns.get(chatId) ?? [])]);
    },
    turns,
  };
}

export const noDedupe: DedupeStore = {
  has() {
    return Promise.resolve(false);
  },
  set() {
    /* intentionally empty */
    return Promise.resolve();
  },
};

/** Describes images as "a red bike" and records what it was given. */
export function fakeDescriber(description = "a red bike") {
  const seen: { bytes: number; mime: string }[] = [];
  const describer: ImageDescriber & { seen: typeof seen } = {
    describe(data, mime) {
      seen.push({ bytes: data.byteLength, mime });
      return Promise.resolve(description);
    },
    seen,
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
  phoneNumberId = "PHONE_1"
): string {
  return JSON.stringify({
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              messages,
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "5511000000000",
                phone_number_id: phoneNumberId,
              },
            },
          },
        ],
        id: "WABA_1",
      },
    ],
    object: "whatsapp_business_account",
  });
}

export function textMessage(id: string, from: string, body: string) {
  return {
    from,
    id,
    text: { body },
    timestamp: "1700000000",
    type: "text",
  };
}
