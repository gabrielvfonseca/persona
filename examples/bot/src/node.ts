import { serve } from "@hono/node-server";
import type { Channel, MessageHandler } from "@persona/core";
import {
  createPool,
  migrate,
  PgKVStorage,
  PgNodeStore,
  syncEmbeddingModel,
} from "@persona/postgres";
import {
  attachBot,
  connectWhatsappSocket,
  WhatsappSocketChannel,
} from "@persona/whatsapp";
import { activeModelFile, resolveModelValue } from "./active-model";
import { createApi } from "./api/app";
import { buildBot } from "./bot";
import { type BotConfig, parseConfig } from "./config";
import { createLocalEmbedder } from "./embedder";
import { pgDatasetSink, pgLearningStore } from "./learning";
import { createLocalModel } from "./local-model";
import { createGroupMemory } from "./memory/group-recall";
import { pgGroupStore } from "./memory/group-store";
import { createPgMemory } from "./memory/pg-memory";
import { loadPersona, redactorFor } from "./persona-file";

/** How often expired `kv` rows are swept. Reads also ignore expired rows, so this only reclaims space. */
const SWEEP_EVERY_MS = 10 * 60_000;

/**
 * Connects to Postgres, applies the schema, and builds the stores for history,
 * dedupe, rate limits, pause state, learning, dataset exports and memory nodes.
 */
async function openPostgres(url: string, config: BotConfig) {
  const pool = createPool(url);
  await migrate(pool);
  const kv = new PgKVStorage(pool);
  const expired = await kv.sweepExpired();
  const nodes = new PgNodeStore(pool, { maxNodes: config.MEMORY_MAX_NODES });
  // Vectors from a different model are not comparable, so a model change re-embeds every node first.
  const embedder = createLocalEmbedder({ model: config.EMBEDDING_MODEL });
  const reembedded = await syncEmbeddingModel({
    embedder,
    kv,
    model: embedder.model,
    onProgress: (done, total) =>
      console.log(`[embedding] re-embedding ${done}/${total}`),
    pool,
  });
  if (reembedded > 0) {
    console.log(`[embedding] re-embedded ${reembedded} node(s)`);
  }
  const memory = await createPgMemory({
    embedder,
    kv,
    maxPerWindow: config.MAX_PER_10MIN,
    nodes,
    rateWindowMs: 600_000,
  });
  const groups = pgGroupStore(pool);
  const sweeper = setInterval(() => {
    kv.sweepExpired().catch((err: unknown) =>
      console.error("[postgres] sweep failed", err)
    );
  }, SWEEP_EVERY_MS);
  sweeper.unref();
  console.log(
    `[postgres] schema ready; ${await nodes.count()} node(s), ${expired} expired key(s) swept`
  );
  return { embedder, groups, kv, memory, pool, sweeper };
}

/**
 * Runs the bot as a WhatsApp linked device on this machine.
 * Scan the QR code in the terminal once; the session lives in AUTH_DIR.
 */
async function main(): Promise<void> {
  const config = parseConfig(process.env);
  const persona = loadPersona(config.PERSONA_FILE);

  // The bot is built once, so its history and pause state survive reconnects.
  // Replies go to whichever socket is currently open.
  let current: WhatsappSocketChannel | null = null;
  const channel: Channel = {
    name: "whatsapp",
    send: (chatId, text, replyTo) => {
      if (!current) {
        throw new Error("not connected to WhatsApp");
      }
      return current.send(chatId, text, replyTo);
    },
  };
  const modelValue = resolveModelValue(
    config.PERSONA_MODEL,
    activeModelFile(config.PERSONA_FILE)
  );
  const model = createLocalModel({
    contextSize: config.MODEL_CONTEXT,
    model: modelValue,
    temperature: config.MODEL_TEMPERATURE,
  });
  console.log(`[model] ${modelValue}`);
  const pg = await openPostgres(config.DATABASE_URL, config);
  const groups = await createGroupMemory({
    base: pg.memory,
    redact: redactorFor(config.PERSONA_FILE),
    store: pg.groups,
  });
  console.log(`[memory] ${groups.index.summaries().length} group(s) loaded`);
  if (config.API_PORT !== undefined) {
    if (!config.API_KEY) {
      throw new Error("API_KEY is required when API_PORT is set.");
    }
    serve({
      fetch: createApi({
        apiKey: config.API_KEY,
        groups: pg.groups,
        index: groups.index,
        personaFile: config.PERSONA_FILE,
      }).fetch,
      port: config.API_PORT,
    });
    console.log(`[api] listening on port ${config.API_PORT}`);
  }
  const bot = await buildBot({
    channel,
    config,
    datasetSink: pgDatasetSink(pg.kv),
    generator: model.generator,
    learningStore: pgLearningStore(pg.kv),
    logger: console,
    memory: groups.memory,
    persona,
  });

  // Pause state is read per message, so a pause set from another process applies here.
  const handler: MessageHandler = {
    async handle(msg) {
      await pg.memory.state.refresh();
      const result = await bot.handle(msg);
      // Outcome only, never the text: chats are private.
      console.log(
        `[handle] ${result.kind}${"reason" in result ? ` (${result.reason})` : ""}`
      );
      return result;
    },
  };

  const sock = await connectWhatsappSocket({
    authDir: config.AUTH_DIR,
    onSocket: (s) => {
      current = new WhatsappSocketChannel(s);
      attachBot(s, handler);
    },
    onStatus: (status) => console.log(`[whatsapp] ${status}`),
    reconnect: true,
  });

  const stop = () => {
    sock.end(undefined);
    clearInterval(pg.sweeper);
    const closed = pg.memory.state.flush().finally(() => pg.pool.end());
    Promise.allSettled([model.unload(), pg.embedder.unload(), closed]).finally(
      () => process.exit(0)
    );
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  console.log(`[persona] ${persona.name} is running (linked device)`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
