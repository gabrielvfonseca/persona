import { sep } from "node:path";
import {
  type PackageJson,
  readPackageJson,
  relativePath,
  workspaceDirs,
} from "./utils";

// Which @persona/* packages each SDK package may depend on. Mirrors the
// "Depends on" column in docs/PACKAGES.md; keep the two in sync.
export const allowedDependencies: Record<string, string[]> = {
  "@persona/core": [],
  "@persona/learning": ["@persona/core", "@persona/schemas"],
  "@persona/memory": ["@persona/core"],
  "@persona/persona": [
    "@persona/core",
    "@persona/schemas",
    "@persona/policy",
    "@persona/memory",
  ],
  "@persona/policy": ["@persona/core"],
  "@persona/postgres": ["@persona/core"],
  "@persona/schemas": [],
  "@persona/whatsapp": ["@persona/core"],
};

// Only packages/* are SDK packages. examples/* is an app and may depend on anything.
const sdkDirs = () =>
  workspaceDirs().filter((dir) =>
    relativePath(dir).startsWith(`packages${sep}`)
  );

const personaDependencies = (pkg: PackageJson) =>
  Object.keys(pkg.dependencies ?? {}).filter((name) =>
    name.startsWith("@persona/")
  );

export const listPackages = () => {
  const rows = workspaceDirs().map((dir) => ({
    dir,
    pkg: readPackageJson(dir),
  }));
  const nameWidth = Math.max(...rows.map(({ pkg }) => pkg.name.length));

  for (const { dir, pkg } of rows) {
    const scripts = Object.keys(pkg.scripts ?? {}).join(", ") || "-";

    console.log(
      `${pkg.name.padEnd(nameWidth)}  ${relativePath(dir).padEnd(22)}  scripts: ${scripts}`
    );
  }
};

export const checkDeps = () => {
  const problems: string[] = [];
  const found = new Set<string>();

  for (const dir of sdkDirs()) {
    const pkg = readPackageJson(dir);
    found.add(pkg.name);

    const allowed = allowedDependencies[pkg.name];

    if (allowed) {
      for (const dep of personaDependencies(pkg)) {
        if (!allowed.includes(dep)) {
          problems.push(`${pkg.name} must not depend on ${dep}`);
        }
      }
    } else {
      problems.push(
        `${pkg.name} (${relativePath(dir)}) is not listed in scripts/packages.ts`
      );
    }
  }

  for (const name of Object.keys(allowedDependencies)) {
    if (!found.has(name)) {
      problems.push(
        `${name} is listed in scripts/packages.ts but has no package`
      );
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`✗ ${problem}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`✓ ${found.size} SDK packages respect the dependency layers`);
};
