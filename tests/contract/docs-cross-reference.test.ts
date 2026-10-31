import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configSchema } from "../../examples/bot/src/config";
import { allowedDependencies } from "../../scripts/packages";

const PATTERN_1 = /^#?\s*(?<g1>[A-Z][A-Z0-9_]*)=/u;
const PATTERN_2 = /^\|\s*`(?<g1>[A-Z][A-Z0-9_]*)`\s*\|/gmu;
const PATTERN_3 = /@persona\/(?<g1>[a-z]+)/gu;
const PATTERN_4 = /`@persona\/(?<g1>[a-z]+)/gu;
const PATTERN_5 = /^\| `@persona\/(?<g1>[a-z]+)` \|[^|]*\|(?<g2>[^|]*)\|/gmu;
const PATTERN_6 = /[`\s]/gu;
const PATTERN_7 = /bun run (?:--cwd examples\/bot )?(?<g1>[a-z-]+)/gu;
const PATTERN_8 = /bun run (?<g1>--cwd examples\/bot )?ingest/u;

const root = join(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const schemaKeys = Object.keys(configSchema.shape);

/** Keys from `KEY=` lines in an env template. Commented-out `# KEY=` lines count as documented. */
const envKeys = (text: string) =>
  text
    .split("\n")
    .map((line) => line.match(PATTERN_1)?.[1])
    .filter((k): k is string => Boolean(k));

/** First-column keys of a markdown table row like "| `KEY` | ...". */
const tableKeys = (text: string) =>
  [...text.matchAll(PATTERN_2)].map((m) => m[1] ?? "");

describe("env documentation matches config.ts", () => {
  it("every key in examples/bot/.env.example is read by config.ts", () => {
    const keys = envKeys(read("examples/bot/.env.example"));
    for (const key of keys) {
      expect(schemaKeys, key).toContain(key);
    }
  });

  it("every config.ts key is listed in examples/bot/.env.example", () => {
    const keys = envKeys(read("examples/bot/.env.example"));
    for (const key of schemaKeys) {
      expect(keys, key).toContain(key);
    }
  });

  it("every key in the DEPLOYMENT.md table is read by config.ts", () => {
    for (const key of tableKeys(read("docs/DEPLOYMENT.md"))) {
      expect(schemaKeys, key).toContain(key);
    }
  });

  it("every config.ts key is documented in DEPLOYMENT.md", () => {
    const documented = tableKeys(read("docs/DEPLOYMENT.md"));
    for (const key of schemaKeys) {
      expect(documented, key).toContain(key);
    }
  });
});

describe("architecture docs match the package graph", () => {
  const packageNames = Object.keys(allowedDependencies).map((n) =>
    n.replace("@persona/", "")
  );

  it("names only packages that exist in ARCHITECTURE.md", () => {
    const text = read("docs/ARCHITECTURE.md");
    const mentioned = [...text.matchAll(PATTERN_3)].map((m) => m[1] ?? "");
    for (const name of new Set(mentioned)) {
      expect(packageNames, name).toContain(name);
    }
  });

  it("names only packages that exist in PACKAGES.md", () => {
    const text = read("docs/PACKAGES.md");
    const mentioned = [...text.matchAll(PATTERN_4)].map((m) => m[1] ?? "");
    for (const name of new Set(mentioned)) {
      expect(packageNames, name).toContain(name);
    }
  });

  it("gives every package a row in the PACKAGES.md dependency table", () => {
    const text = read("docs/PACKAGES.md");
    for (const name of packageNames) {
      expect(text).toContain(`\`@persona/${name}\``);
    }
  });

  it("states the same @persona/* dependencies as scripts/packages.ts", () => {
    const rows = [...read("docs/PACKAGES.md").matchAll(PATTERN_5)];
    expect(rows.length).toBe(packageNames.length);
    for (const [, name, dependsOn] of rows) {
      const declared = (dependsOn ?? "")
        .split(",")
        .map((s) => s.replace(PATTERN_6, ""))
        .filter((s) => packageNames.includes(s));
      expect(declared.sort(), `@persona/${name}`).toEqual(
        (allowedDependencies[`@persona/${name}`] ?? [])
          .map((d) => d.replace("@persona/", ""))
          .sort()
      );
    }
  });
});

describe("README quick start references real scripts", () => {
  it("every `bun run --cwd examples/bot <script>` in README.md exists in examples/bot/package.json", () => {
    const scripts = scriptNames(JSON.parse(read("examples/bot/package.json")));
    const used = [...read("README.md").matchAll(PATTERN_7)].map(
      (m) => m[1] ?? ""
    );
    for (const name of new Set(used)) {
      expect(scripts, name).toContain(name);
    }
  });

  it("no doc tells users to run the removed ingest command", () => {
    const docs = [
      "README.md",
      "DEPLOY.md",
      "docs/API.md",
      "docs/PACKAGES.md",
      "examples/bot/.env.example",
    ];
    for (const doc of docs) {
      expect(read(doc), doc).not.toMatch(PATTERN_8);
    }
  });
});

/** The script names in a parsed package.json. Anything without scripts has none. */
function scriptNames(manifest: unknown): string[] {
  if (typeof manifest !== "object" || manifest === null) {
    return [];
  }
  if (!("scripts" in manifest)) {
    return [];
  }
  const { scripts } = manifest;
  return typeof scripts === "object" && scripts !== null
    ? Object.keys(scripts)
    : [];
}
