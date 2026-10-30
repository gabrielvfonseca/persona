import type { MessageHandler } from "@persona/core";
import {
  kvDedupeStore,
  kvHistoryStore,
  kvRateLimiter,
  loadKvBotState,
} from "@persona/kv";
import { createMemory } from "@persona/memory";
import { type Persona, parsePersona } from "@persona/schemas";
import {
  CloudApiClient,
  createCloudApiWebhook,
  type ExecutionContextLike,
} from "@persona/whatsapp/cloud";
import { Hono } from "hono";
import { basicAuth } from "./auth";
import { buildBot } from "./bot";
import { type CloudApiConfig, parseConfig } from "./config";

export { WhatsAppConnection } from "./connection";

interface Bindings {
  CONVERSATIONS: Parameters<typeof kvHistoryStore>[0];
  WHATSAPP: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(req: Request): Promise<Response> };
  };
}

const CF_BOT_PREFIX = /^\/cf-bot/u;

/** Hono throws when there is no ExecutionContext (tests, Bun). Treat that as absent. */
function executionContext(c: {
  executionCtx: unknown;
}): ExecutionContextLike | undefined {
  try {
    return c.executionCtx as ExecutionContextLike;
  } catch {
    return undefined;
  }
}

/** The persona travels as a secret, so the bundle needs no data file. */
function personaFromEnv(env: Record<string, string | undefined>): Persona {
  if (!env.PERSONA_JSON) {
    throw new Error(
      "PERSONA_JSON is missing. Set it to the contents of data/persona.json.",
    );
  }
  return parsePersona(JSON.parse(env.PERSONA_JSON));
}

/**
 * Cloud API webhook on `/webhook/whatsapp`, plus the admin proxy to the
 * linked-device Durable Object on `/cf-bot/*` (Basic auth with ADMIN_KEY).
 */
export async function createWorker(
  env: Record<string, string | undefined>,
  bindings: Bindings,
) {
  const config = parseConfig(env, "cloud-api") as CloudApiConfig;
  const persona = personaFromEnv(env);
  const app = new Hono();

  const client = new CloudApiClient({
    phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: config.WHATSAPP_ACCESS_TOKEN,
  });

  // History, dedupe, rate limits and pause state live in KV, so they survive
  // isolate restarts and are shared by every isolate.
  const kv = bindings.CONVERSATIONS;
  const state = await loadKvBotState(kv);
  const memory = {
    ...createMemory(),
    history: kvHistoryStore(kv),
    dedupe: kvDedupeStore(kv),
    rateLimiter: kvRateLimiter(kv, {
      maxPerWindow: config.MAX_PER_10MIN,
      windowMs: 600_000,
    }),
    state,
  };

  const bot = buildBot({
    config,
    persona,
    channel: client,
    transport: "cloud-api",
    logger: console,
    memory,
  });

  // Save a pause or resume before the response is sent.
  const handler: MessageHandler = {
    async handle(msg) {
      const result = await bot.handle(msg);
      await state.flush();
      return result;
    },
  };

  const webhook = createCloudApiWebhook({
    bot: handler,
    downloadMedia: (id, maxBytes) => client.downloadMedia(id, maxBytes),
    appSecret: config.WHATSAPP_APP_SECRET,
    verifyToken: config.WHATSAPP_VERIFY_TOKEN,
    phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
  });

  app.get("/webhook/whatsapp", (c) => webhook(c.req.raw));
  app.post("/webhook/whatsapp", (c) => webhook(c.req.raw, executionContext(c)));

  app.all("/cf-bot/*", (c) => {
    const denied = basicAuth(c.req.raw, config.ADMIN_KEY);
    if (denied) return denied;
    const url = new URL(c.req.url);
    url.pathname = url.pathname.replace(CF_BOT_PREFIX, "");
    const stub = bindings.WHATSAPP.get(
      bindings.WHATSAPP.idFromName("main-v11"),
    );
    return stub.fetch(
      new Request(url, { headers: c.req.raw.headers, method: c.req.method }),
    );
  });

  app.get("/admin/persona", (c) => {
    const denied = basicAuth(c.req.raw, config.ADMIN_KEY);
    if (denied) return denied;
    return c.json({ ok: true, name: persona.name });
  });

  return app;
}

export default {
  async fetch(
    req: Request,
    env: Record<string, string | undefined> & Bindings,
  ): Promise<Response> {
    const app = await createWorker(env, env);
    return app.fetch(req, env);
  },
};
