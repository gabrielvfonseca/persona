/**
 * Serves the ingest API without WhatsApp, for loading exports ahead of time.
 *
 *   API_PORT=8787 API_KEY=... bun run api
 */

import { serve } from "@hono/node-server";
import { createMemory } from "@persona/memory";
import { createPool, migrate } from "@persona/postgres";
import { createApi } from "../src/api/app";
import { parseConfig } from "../src/config";
import { createGroupMemory } from "../src/memory/group-recall";
import { pgGroupStore } from "../src/memory/group-store";

try {
  process.loadEnvFile(".env");
} catch {
  // Defaults apply without a .env file.
}
const config = parseConfig({
  PERSONA_CONSENT: "true",
  PERSONA_MODEL: "qwen2.5-0.5b",
  PERSONA_NAME: "bot",
  ...process.env,
});
if (config.API_PORT === undefined) {
  throw new Error("Set API_PORT to serve the API.");
}
if (!config.API_KEY) {
  throw new Error("Set API_KEY (16+ characters) to serve the API.");
}

const pool = createPool(config.DATABASE_URL);
await migrate(pool);
const groups = pgGroupStore(pool);
const { index } = await createGroupMemory({
  base: createMemory({ maxNodes: config.MEMORY_MAX_NODES }),
  store: groups,
});
serve({
  fetch: createApi({
    apiKey: config.API_KEY,
    groups,
    index,
    personaFile: config.PERSONA_FILE,
  }).fetch,
  port: config.API_PORT,
});
console.log(`[api] listening on http://localhost:${config.API_PORT}`);
