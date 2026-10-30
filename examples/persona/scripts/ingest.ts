/**
 * Builds data/persona.json from a WhatsApp chat export.
 *
 *   bun run ingest <export.txt> --list                 # senders by message count
 *   bun run ingest <export.txt> --person "Name" [--name "Display"] [--out path]
 *       [--fact "A fact about the person"]... [--facts facts.txt]
 *
 * Quotes and example exchanges come from the export. Re-running keeps the
 * hand-written styleGuide, phrases, facts and languageHint, and adds any
 * --fact or --facts lines (one per line) without duplicates.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type Persona, parsePersona } from "@persona/schemas";
import { listSenders, parseExport, trainFromExport } from "@persona/training";

const HAND_WRITTEN = [
  "styleGuide",
  "phrases",
  "facts",
  "languageHint",
] as const;
const USAGE =
  'Usage: bun run ingest <export.txt> [--list | --person "Name"] [--name "Display"] [--out path]';

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Every value given to a repeatable flag, e.g. --fact "a" --fact "b". */
function flagAll(args: string[], name: string): string[] {
  return args.flatMap((a, i) =>
    a === name && args[i + 1] ? [args[i + 1] as string] : [],
  );
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const [file] = args;
if (!file || file.startsWith("--")) fail(USAGE);

const raw = readFileSync(file, "utf8");

if (args.includes("--list")) {
  for (const sender of listSenders(parseExport(raw))) {
    console.log(sender);
  }
  process.exit(0);
}

function readLines(path: string): string[] {
  return readFileSync(path, "utf8").split("\n");
}

const sender = flag(args, "--person");
if (!sender)
  fail('Missing --person "Name". Run with --list to see the senders.');

const out = flag(args, "--out") ?? "data/persona.json";
const name = flag(args, "--name") ?? sender;

let persona: Persona;
try {
  persona = trainFromExport(raw, { sender, name });
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

if (existsSync(out)) {
  try {
    const previous = parsePersona(JSON.parse(readFileSync(out, "utf8")));
    for (const key of HAND_WRITTEN) {
      Object.assign(persona, { [key]: previous[key] });
    }
  } catch {
    console.warn(`Could not read ${out}; hand-written fields were not kept.`);
  }
}

const newFacts = [
  ...flagAll(args, "--fact"),
  ...(flag(args, "--facts") ? readLines(flag(args, "--facts") as string) : []),
];
persona.facts = [
  ...new Set([
    ...persona.facts,
    ...newFacts.map((f) => f.trim()).filter(Boolean),
  ]),
];

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(persona, null, 2)}\n`);
console.log(`Wrote ${out}: ${persona.quotes.length} quotes from ${sender}`);
