import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { root, run } from "./utils";

// Env templates the example bot reads. Copied to `.env` only when it does not exist yet.
const envTemplates = [{ dir: join(root, "examples", "bot") }];

export const setup = () => {
  if (!existsSync(join(root, "node_modules"))) {
    console.log("Installing dependencies with bun...");
    run("bun", ["install"]);
  }

  for (const { dir } of envTemplates) {
    const example = join(dir, ".env.example");
    const target = join(dir, ".env");

    if (existsSync(target)) {
      console.log(`- ${target} already exists, leaving it alone`);
    } else {
      copyFileSync(example, target);
      console.log(`✓ Created ${target} from .env.example`);
    }
  }

  console.log(`
Next steps:
  1. Fill in examples/bot/.env. Set PERSONA_CONSENT=true only with the subject's consent.
  2. Try it offline:  bun run --cwd examples/bot simulate
  3. Run it:          bun run --cwd examples/bot bot`);
};
