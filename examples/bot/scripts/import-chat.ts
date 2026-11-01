/**
 * Imports a person's chat history: writes the persona file, then loads the group
 * and direct messages into Postgres with embeddings and graph edges.
 *
 *   bun run import-chat -- --group ../../trainning/chat.json \
 *     --direct ../../trainning/dm_01.json --direct ../../trainning/dm_02.json \
 *     --name Calhau --alias "Pedro Andrade" --alias calhau \
 *     --exclude "Calhau[bot]" --out data/pedro
 *
 * Reads DATABASE_URL from the environment (or .env). Pass --no-db to only write
 * the persona file. Re-running is safe: existing records and nodes are skipped.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createPool, migrate, PgNodeStore } from "@persona/postgres";
import { createLocalEmbedder } from "../src/embedder";
import {
  assignWindows,
  readChatExport,
  type WindowedMessage,
} from "../src/import/chat-json";
import { buildChatPersona, cleanText } from "../src/import/chat-persona";
import type { GroupRecord } from "../src/memory/group-import";
import { recordId } from "../src/memory/group-import";
import { pgGroupStore } from "../src/memory/group-store";

/** Racial slurs and the like. Lines matching these are never learned or stored as persona text. */
const BLOCKLIST = [/\bn+[i1l]+g+[ae]+r*s?\b/iu, /\bnigg/iu];

const NODE_BATCH = 256;
/** Characters embedded per message. Longer messages keep their full text in the store. */
const EMBED_CHARS = 400;
/** Used for a single message the model still cannot take at EMBED_CHARS. */
const FALLBACK_EMBED_CHARS = 120;

function flagValues(tokens: string[], option: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] === option && tokens[i + 1] !== undefined) {
      out.push(tokens[i + 1] as string);
    }
  }
  return out;
}

function flagValue(tokens: string[], option: string): string | undefined {
  return flagValues(tokens, option)[0];
}

function slugOf(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const argv = process.argv.slice(2);
const groupFiles = flagValues(argv, "--group");
const directFiles = flagValues(argv, "--direct");
const aliases = flagValues(argv, "--alias");
const excluded = new Set(
  flagValues(argv, "--exclude").map((s) => s.toLowerCase())
);
const personName = flagValue(argv, "--name");
const outDir =
  flagValue(argv, "--out") ?? join("data", slugOf(personName ?? "persona"));
const dryDb = argv.includes("--no-db");

if (groupFiles.length === 0 && directFiles.length === 0) {
  fail("Pass at least one --group or --direct file.");
}
if (!personName) {
  fail("Pass --name, the name the persona answers to.");
}
if (aliases.length === 0) {
  fail("Pass --alias for each name this person appears under.");
}

const readFile = (path: string) => {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  return { messages: readChatExport(raw), raw };
};

// Group chats: the group name comes from the export, and excluded senders (bots) are dropped.
const groups = groupFiles.map((path) => {
  const { raw, messages } = readFile(path);
  const chatName =
    typeof (raw as { chat_name?: unknown }).chat_name === "string"
      ? (raw as { chat_name: string }).chat_name
      : basename(path, ".json");
  const kept = messages.filter((m) => !excluded.has(m.sender.toLowerCase()));
  return { id: slugOf(chatName), messages: assignWindows(kept) };
});
const direct = directFiles.map((path) => {
  const { messages } = readFile(path);
  return assignWindows(
    messages.filter((m) => !excluded.has(m.sender.toLowerCase()))
  );
});

const groupMessages: { group: string; message: WindowedMessage }[] =
  groups.flatMap((g) =>
    g.messages.map((message) => ({ group: g.id, message }))
  );
const directMessages: WindowedMessage[] = direct.flat();

const persona = buildChatPersona(
  { direct: directMessages, group: groupMessages.map((g) => g.message) },
  {
    aliases,
    blocklist: BLOCKLIST,
    languageHint: "pt",
    name: personName,
    styleGuide:
      "Short, casual Portuguese, the way people text in a group chat. Lowercase is normal. Slang and abbreviations (q, pq, tmb, msm, agr, hj, vcs, nsns) and laughter (ahah, 😂) are natural. Usually one short line, rarely more.",
  }
);
mkdirSync(outDir, { recursive: true });
const personaPath = join(outDir, "persona.json");
writeFileSync(personaPath, `${JSON.stringify(persona, null, 2)}\n`);
console.log(
  `Persona: ${persona.quotes.length} quotes, ${persona.phrases.length} phrases, ${(persona.exchanges ?? []).length} exchanges, ${persona.stats.messageCount ?? 0} own messages -> ${personaPath}`
);

if (dryDb) {
  process.exit(0);
}
const url = process.env.DATABASE_URL;
if (!url) {
  fail("DATABASE_URL is not set. Pass --no-db to only write the persona file.");
}

const pool = createPool(url, 4);
await migrate(pool);
const embedder = createLocalEmbedder({ model: process.env.EMBEDDING_MODEL });
// Imports hold far more nodes than the bot's default cap, so the cap is lifted here.
const nodes = new PgNodeStore(pool, { maxNodes: 10_000_000 });
const isPerson = (sender: string) =>
  aliases.some((a) => a.toLowerCase() === sender.toLowerCase());

const fromGroup: GroupRecord[] = groupMessages.map(({ group, message }) => {
  const text = cleanText(message.text);
  return {
    group,
    id: recordId(group, message.ts, message.sender, text),
    sender: message.sender,
    text,
    ts: message.ts,
    windowId: message.windowId,
  };
});
const groupStore = pgGroupStore(pool);
for (const id of groups.map((g) => g.id)) {
  const batch = fromGroup.filter((r) => r.group === id);
  for (let i = 0; i < batch.length; i += 5000) {
    // biome-ignore lint/performance/noAwaitInLoops: batches are written one after another, so the database is not flooded
    await groupStore.append(id, batch.slice(i, i + 5000));
  }
  console.log(`group ${id}: ${batch.length} records stored`);
}

const dmId = `dm:${slugOf(personName)}`;
const fromDirect = directMessages.map((message) => {
  const text = cleanText(message.text);
  return {
    chatId: dmId,
    id: recordId(dmId, message.ts, message.sender, text),
    message: { ...message, text },
  };
});

interface Item {
  chatId: string;
  id: string;
  kind: "turn" | "quote";
  role: "user" | "assistant";
  sender: string;
  text: string;
  ts: number;
  windowId: number;
}
const items: Item[] = [
  ...fromGroup.map(
    (r): Item => ({
      chatId: `group:${r.group}`,
      id: r.id,
      kind: "turn",
      role: isPerson(r.sender) ? "assistant" : "user",
      sender: r.sender,
      text: `${r.sender}: ${r.text}`,
      ts: r.ts,
      windowId: r.windowId,
    })
  ),
  ...fromDirect.map(
    (d): Item => ({
      chatId: d.chatId,
      id: d.id,
      kind: "quote",
      role: "assistant",
      sender: d.message.sender,
      text: `${d.message.sender}: ${d.message.text}`,
      ts: d.message.ts,
      windowId: d.message.windowId,
    })
  ),
];

// Bulk load: the HNSW index is rebuilt once at the end, not updated on every insert.
await pool.query("DROP INDEX IF EXISTS pg_nodes_embedding_idx");
const existing = new Set(
  (await pool.query<{ id: string }>("SELECT id FROM pg_nodes")).rows.map(
    (r) => r.id
  )
);
const missing = items.filter((item) => !existing.has(item.id));
console.log(`nodes: ${existing.size} already stored, ${missing.length} to add`);

/**
 * Embeds a batch. If the model rejects one text as too long, that text is retried
 * alone with a shorter prefix, so one unusual message cannot stop the import.
 */
/** The model's own message for a text it cannot take, as opposed to any other failure. */
const CONTEXT_OVERFLOW = /CONTEXT_OVERFLOW|context holds/u;

async function embedBatch(batch: readonly Item[]): Promise<number[][]> {
  try {
    return await embedder.embed(
      batch.map((item) => item.text.slice(0, EMBED_CHARS))
    );
  } catch (err) {
    const { code } = err as { code?: unknown };
    const overflow =
      err instanceof Error &&
      (CONTEXT_OVERFLOW.test(err.message) ||
        CONTEXT_OVERFLOW.test(String(code)));
    if (!overflow) {
      throw err;
    }
    const out: number[][] = [];
    for (const item of batch) {
      // Each message gets its own call so the fallback is per message, not per batch.
      // biome-ignore lint/performance/noAwaitInLoops: one message at a time, so a single long one only shortens itself
      const [vector = []] = await embedder.embed([
        item.text.slice(0, FALLBACK_EMBED_CHARS),
      ]);
      out.push(vector);
    }
    return out;
  }
}

let stored = 0;
for (let i = 0; i < missing.length; i += NODE_BATCH) {
  const slice = missing.slice(i, i + NODE_BATCH);
  // The embedding model reads at most ~512 tokens; the stored text is kept in full.
  // biome-ignore lint/performance/noAwaitInLoops: batches run one after another so the model runs one batch at a time
  const vectors = await embedBatch(slice);
  await nodes.addMany(
    slice.map((item, j) => ({
      chatId: item.chatId,
      createdAt: item.ts,
      embedding: vectors[j],
      id: item.id,
      kind: item.kind,
      role: item.role,
      text: item.text,
    })),
    { evict: false }
  );
  stored += slice.length;
  if (stored % (NODE_BATCH * 20) === 0 || stored === missing.length) {
    console.log(`nodes: ${stored}/${missing.length} added`);
  }
}
// Building the index on a large table can outlast the server's statement timeout,
// so it runs on its own connection with the timeout lifted.
const indexClient = await pool.connect();
try {
  await indexClient.query("SET statement_timeout = 0");
  await indexClient.query(
    "CREATE INDEX IF NOT EXISTS pg_nodes_embedding_idx ON pg_nodes USING hnsw (embedding vector_cosine_ops)"
  );
} finally {
  indexClient.release();
}
console.log("embedding index ready");

// Graph: each message follows the one before it in its window; a reply from the
// person answers the message it followed.
const edges: { source: string; target: string; rel: string }[] = [];
for (let i = 1; i < items.length; i += 1) {
  const prev = items[i - 1];
  const cur = items[i];
  if (
    !(prev && cur) ||
    prev.chatId !== cur.chatId ||
    prev.windowId !== cur.windowId
  ) {
    continue;
  }
  edges.push({ rel: "follows", source: prev.id, target: cur.id });
  if (isPerson(cur.sender) && !isPerson(prev.sender)) {
    edges.push({ rel: "answers", source: cur.id, target: prev.id });
  }
}
let linked = 0;
for (let i = 0; i < edges.length; i += 5000) {
  // biome-ignore lint/performance/noAwaitInLoops: edge batches are written one after another, so the database is not flooded
  linked += await nodes.linkMany(edges.slice(i, i + 5000));
}
console.log(`edges: ${linked} written (${edges.length} considered)`);

await embedder.unload();
await pool.end();
