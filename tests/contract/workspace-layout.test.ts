import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allowedDependencies } from "../../scripts/packages";

const root = join(import.meta.dirname, "../..");
interface PackageManifest {
  name: string;
  scripts?: Record<string, string>;
  workspaces?: string[];
}
function isPackageManifest(value: unknown): value is PackageManifest {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string"
  );
}

const readJson = (p: string): PackageManifest => {
  const parsed: unknown = JSON.parse(readFileSync(p, "utf8"));
  if (!isPackageManifest(parsed)) {
    throw new Error(`${p} has no name`);
  }
  return parsed;
};
const dirsOf = (rel: string) =>
  readdirSync(join(root, rel), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

const sdkPackages = dirsOf("packages").map((dir) => ({
  dir,
  pkg: readJson(join(root, "packages", dir, "package.json")),
}));

describe("workspace layout", () => {
  it("declares packages/* and examples/* as workspaces", () => {
    expect(readJson(join(root, "package.json")).workspaces).toEqual([
      "packages/*",
      "examples/*",
    ]);
  });

  it("names every SDK package @persona/<directory>", () => {
    for (const { dir, pkg } of sdkPackages) {
      expect(pkg.name, dir).toBe(`@persona/${dir}`);
    }
  });

  it("lists every SDK package in the dependency rules of scripts/packages.ts", () => {
    expect(Object.keys(allowedDependencies).sort()).toEqual(
      sdkPackages.map((p) => p.pkg.name).sort()
    );
  });

  it("has a test directory with at least one test in every package and example", () => {
    const owners = [
      ...dirsOf("packages").map((d) => join("packages", d)),
      ...dirsOf("examples").map((d) => join("examples", d)),
    ];
    for (const rel of owners) {
      const testsDir = join(root, rel, "tests");
      expect(existsSync(testsDir), rel).toBe(true);
      const hasTests = readdirSync(testsDir, { recursive: true }).some((f) =>
        String(f).endsWith(".test.ts")
      );
      expect(hasTests, rel).toBe(true);
    }
  });

  it("gives every package a test script", () => {
    for (const { dir, pkg } of sdkPackages) {
      expect(pkg.scripts?.test, dir).toBeDefined();
    }
  });
});
