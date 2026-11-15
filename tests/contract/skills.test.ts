import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const PATTERN_1 = /^---\n(?<g1>[\s\S]*?)\n---/u;
const PATTERN_2 = /^\s+-\s+(?<g1>\S+\.ts)\s*$/gmu;
const PATTERN_3 = /^## Exports\s*$/mu;
const PATTERN_4 = /^## /mu;
const PATTERN_5 = /^- `(?<g1>[A-Za-z_][A-Za-z0-9_]*)`/gmu;
const PATTERN_6 = /\]\((?<g1>\.[^)#\s]*)(?:#[^)]*)?\)/gu;

const root = join(import.meta.dirname, "../..");
const skillsDir = join(root, "skills");

const skillDirs = readdirSync(skillsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

interface Skill {
  description?: string | undefined;
  dir: string;
  exports: string[];
  file: string;
  modules: string[];
  name?: string | undefined;
  text: string;
}

/** Reads the frontmatter and the `## Exports` bullets. Frontmatter lists are simple `- item` blocks. */
function parse(dir: string): Skill {
  const file = join(skillsDir, dir, "SKILL.md");
  const text = readFileSync(file, "utf8");
  const fm = text.match(PATTERN_1)?.[1] ?? "";
  const field = (key: string) =>
    fm.match(new RegExp(`^${key}:\\s*(.+)$`, "mu"))?.[1]?.trim();
  const modules = [...fm.matchAll(PATTERN_2)].map((m) => m[1] ?? "");
  const exportsSection = text.split(PATTERN_3)[1]?.split(PATTERN_4)[0] ?? "";
  const exports = [...exportsSection.matchAll(PATTERN_5)].map(
    (m) => m[1] ?? ""
  );
  return {
    description: field("description"),
    dir,
    exports,
    file,
    modules,
    name: field("name"),
    text,
  };
}

const skills = skillDirs.map(parse);

describe("skills index", () => {
  it("has a SKILL.md in every folder under skills/", () => {
    for (const skill of skills) {
      expect(existsSync(skill.file), skill.dir).toBe(true);
    }
  });

  it("links every skill folder from skills/README.md", () => {
    const index = readFileSync(join(skillsDir, "README.md"), "utf8");
    for (const dir of skillDirs) {
      expect(index, dir).toContain(`${dir}/SKILL.md`);
    }
  });
});

describe.each(skills.map((s) => [s.dir, s] as const))(
  "skill %s",
  (_dir, skill) => {
    it("has frontmatter name equal to its folder", () => {
      expect(skill.name).toBe(skill.dir);
    });

    it("has a one-line description", () => {
      expect(skill.description?.length ?? 0).toBeGreaterThan(40);
    });

    it("points at modules that exist", () => {
      for (const mod of skill.modules) {
        expect(existsSync(join(root, mod)), mod).toBe(true);
      }
    });

    it("only lists exports that the modules really export", async () => {
      if (skill.exports.length === 0) {
        return;
      }
      const loaded = await Promise.all(
        skill.modules.map(
          (m) => import(join(root, m)) as Promise<Record<string, unknown>>
        )
      );
      for (const name of skill.exports) {
        const found = loaded.some((mod) => name in mod);
        expect(found, `${name} in ${skill.modules.join(", ")}`).toBe(true);
      }
    },
    // The example-bot modules pull in ggml-node's native bindings, so the
    // dynamic imports can exceed the 5s default under test-worker concurrency.
    30_000
  );

    it("resolves every relative markdown link", () => {
      const links = [...skill.text.matchAll(PATTERN_6)].map((m) => m[1] ?? "");
      for (const link of links) {
        const target = join(dirname(skill.file), link);
        expect(existsSync(target), link).toBe(true);
      }
    });
  }
);
