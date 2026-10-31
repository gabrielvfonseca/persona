import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cloudApiSchema,
  linkedDeviceSchema,
} from "../../examples/bot/src/config";
import { allowedDependencies } from "../../scripts/packages";

const root = join(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const schemaKeys = [
  ...new Set([
    ...Object.keys(linkedDeviceSchema.shape),
    ...Object.keys(cloudApiSchema.shape),
  ]),
];

/** Keys from `KEY=` lines in an env template. Commented-out `# KEY=` lines count as documented. */
const envKeys = (text: string) =>
  text
    .split("\n")
    .map((line) => line.match(/^#?\s*([A-Z][A-Z0-9_]*)=/)?.[1])
    .filter((k): k is string => Boolean(k));

/** First-column keys of a markdown table row like "| `KEY` | ...". */
const tableKeys = (text: string) =>
  [...text.matchAll(/^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|/gm)].map((m) => m[1] ?? "");

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
    n.replace("@persona/", ""),
  );

  it("names only packages that exist in ARCHITECTURE.md", () => {
    const text = read("docs/ARCHITECTURE.md");
    const mentioned = [...text.matchAll(/@persona\/([a-z]+)/g)].map(
      (m) => m[1] ?? "",
    );
    for (const name of new Set(mentioned)) {
      expect(packageNames, name).toContain(name);
    }
  });

  it("names only packages that exist in PACKAGES.md", () => {
    const text = read("docs/PACKAGES.md");
    const mentioned = [...text.matchAll(/`@persona\/([a-z]+)/g)].map(
      (m) => m[1] ?? "",
    );
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
    const rows = [
      ...read("docs/PACKAGES.md").matchAll(
        /^\| `@persona\/([a-z]+)` \|[^|]*\|([^|]*)\|/gm,
      ),
    ];
    expect(rows.length).toBe(packageNames.length);
    for (const [, name, dependsOn] of rows) {
      const declared = (dependsOn ?? "")
        .split(",")
        .map((s) => s.replace(/[`\s]/g, ""))
        .filter((s) => packageNames.includes(s));
      expect(declared.sort(), `@persona/${name}`).toEqual(
        (allowedDependencies[`@persona/${name}`] ?? [])
          .map((d) => d.replace("@persona/", ""))
          .sort(),
      );
    }
  });
});

describe("README quick start references real scripts", () => {
  it("every `bun run --cwd examples/bot <script>` in README.md exists in examples/bot/package.json", () => {
    const scripts = JSON.parse(read("examples/bot/package.json"))
      .scripts as Record<string, string>;
    const used = [
      ...read("README.md").matchAll(
        /bun run (?:--cwd examples\/bot )?([a-z-]+)/g,
      ),
    ].map((m) => m[1] ?? "");
    // "ingest" is a known gap, tracked by the it.fails test below.
    const knownMissing = new Set(["ingest"]);
    for (const name of new Set(used)) {
      if (knownMissing.has(name)) continue;
      expect(Object.keys(scripts), name).toContain(name);
    }
  });

  // Known gap: README.md and DEPLOY.md still document `bun run ingest`, but the ingest
  // command and @persona/training were removed. It.fails stays green until the docs or a
  // real ingest script land.
  it.fails("the documented ingest command exists", () => {
    const scripts = JSON.parse(read("examples/bot/package.json"))
      .scripts as Record<string, string>;
    expect(Object.keys(scripts)).toContain("ingest");
  });
});
