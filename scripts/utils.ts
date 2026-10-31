import { type SpawnSyncOptions, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const PATTERN_1 = /\/\*$/u;

export const root = resolve(import.meta.dirname, "..");

export interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name: string;
  private?: boolean;
  scripts?: Record<string, string>;
  version?: string;
  workspaces?: string[];
}

function isPackageJson(value: unknown): value is PackageJson {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string"
  );
}

export const readPackageJson = (dir: string): PackageJson => {
  const path = join(dir, "package.json");
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isPackageJson(parsed)) {
    throw new Error(`${path} has no "name" field`);
  }
  return parsed;
};

export const relativePath = (path: string) => relative(root, path) || ".";

// Expands the root `workspaces` globs. Only `dir/*` patterns are used in this repo.
export const workspaceDirs = (): string[] => {
  const { workspaces = [] } = readPackageJson(root);

  return workspaces.flatMap((pattern) => {
    const base = join(root, pattern.replace(PATTERN_1, ""));

    return readdirSync(base, { withFileTypes: true })
      .map((entry) => join(base, entry.name))
      .filter((dir) => existsSync(join(dir, "package.json")));
  });
};

export const run = (
  command: string,
  args: string[],
  options?: SpawnSyncOptions
) => {
  const result = spawnSync(command, args, {
    cwd: root,
    shell: process.platform === "win32",
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `Command failed with exit code ${result.status}: ${command} ${args.join(" ")}`
    );
  }

  return result;
};
