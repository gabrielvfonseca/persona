/**
 * Ingests WhatsApp exports (.txt) into the bot's data.
 *
 *   # the persona: the voice to learn, from one person's messages
 *   bun run ingest persona <export.txt> --sender "Name" [--name "Display"] [--fact "..."]... [--facts file.txt]
 *   bun run ingest persona <export.txt> --list           # senders by message count
 *
 *   # group memory: a group chat, indexed for recall
 *   bun run ingest group <export.txt> --group <id>
 *
 * Re-running keeps hand-written persona fields and skips group messages already stored.
 */
import { readFileSync } from "node:fs";
import { createPool, migrate } from "@persona/postgres";
import { pathsFromEnv } from "../src/config";
import { listSenders, parseExport } from "../src/ingest";
import { writePersonaFile } from "../src/ingest/persona-file";
import { importGroupExport } from "../src/memory/group-import";
import { assertGroupId, pgGroupStore } from "../src/memory/group-store";

const USAGE = [
  "Usage:",
  '  ingest persona <export.txt> --sender "Name" [--name "Display"] [--fact "..."]... [--facts file.txt]',
  "  ingest persona <export.txt> --list",
  "  ingest group <export.txt> --group <id>",
].join("\n");

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function flagAll(args: string[], name: string): string[] {
  return args.flatMap((a, i) =>
    a === name && args[i + 1] ? [args[i + 1] as string] : []
  );
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const [kind, file, ...rest] = process.argv.slice(2);
if (!(kind && file)) {
  fail(USAGE);
}

try {
  process.loadEnvFile(".env");
} catch {
  // No .env file is fine: the defaults apply.
}
const paths = pathsFromEnv(process.env);
const raw = readFileSync(file, "utf8");

if (kind === "persona") {
  if (rest.includes("--list")) {
    for (const sender of listSenders(parseExport(raw))) {
      console.log(sender);
    }
    process.exit(0);
  }
  const sender = flag(rest, "--sender");
  if (!sender) {
    fail('Missing --sender "Name". Run with --list to see the senders.');
  }
  const factLines = flag(rest, "--facts")
    ? readFileSync(flag(rest, "--facts") as string, "utf8").split("\n")
    : [];
  try {
    const result = writePersonaFile(raw, {
      facts: [...flagAll(rest, "--fact"), ...factLines],
      name: flag(rest, "--name"),
      out: paths.personaFile,
      sender,
    });
    console.log(
      `Wrote ${paths.personaFile}: ${result.quotes} quotes, ${result.exchanges} exchanges, ${result.factCount} facts.`
    );
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
} else if (kind === "group") {
  const group = flag(rest, "--group");
  if (!group) {
    fail("Missing --group <id>.");
  }
  const id = assertGroupId(group);
  const records = importGroupExport(raw, id);
  const url = process.env.DATABASE_URL;
  if (!url) {
    fail("Set DATABASE_URL to store group records.");
  }
  const pool = createPool(url);
  await migrate(pool);
  const added = await pgGroupStore(pool).append(id, records);
  await pool.end();
  console.log(
    `Group ${id}: parsed ${records.length}, added ${added}, skipped ${records.length - added}.`
  );
} else {
  fail(USAGE);
}
