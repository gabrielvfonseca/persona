import { type SpawnSyncOptions, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const root = resolve(import.meta.dirname, "..");

export interface PackageJson {
  name: string;
  version?: string;
  private?: boolean;
  workspaces?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

export const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(path, "utf8")) as T;

export const readPackageJson = (dir: string): PackageJson =>
  readJson<PackageJson>(join(dir, "package.json"));

export const relativePath = (path: string) => relative(root, path) || ".";

// Expands the root `workspaces` globs. Only `dir/*` patterns are used in this repo.
export const workspaceDirs = (): string[] => {
  const { workspaces = [] } = readPackageJson(root);

  return workspaces.flatMap((pattern) => {
    const base = join(root, pattern.replace(/\/\*$/, ""));

    return readdirSync(base, { withFileTypes: true })
      .map((entry) => join(base, entry.name))
      .filter((dir) => existsSync(join(dir, "package.json")));
  });
};

export const run = (
  command: string,
  args: string[],
  options?: SpawnSyncOptions,
) => {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `Command failed with exit code ${result.status}: ${command} ${args.join(" ")}`,
    );
  }

  return result;
};
