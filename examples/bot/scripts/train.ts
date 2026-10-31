/**
 * Fine-tunes the small model on the persona's example exchanges.
 *
 *   bun run train                       # qwen2.5-0.5b, 300 iterations
 *   bun run train --model qwen2.5-1.5b --iters 500
 *   bun run train --dry-run             # writes the dataset and prints the commands
 *
 * Needs Apple Silicon with mlx-lm installed (see examples/bot/README.md), and a
 * llama.cpp checkout for the GGUF converter. The result is promoted only if it
 * beats the base model and the model currently in use.
 */
import { dirname, join } from "node:path";
import { activeModelFile } from "../src/active-model";
import { pathsFromEnv } from "../src/config";
import { loadPersona } from "../src/persona-file";
import { processRunner, runTraining, trainingBaseFor } from "../src/training";

function flagValue(argv: string[], option: string): string | undefined {
  const i = argv.indexOf(option);
  return i >= 0 ? argv[i + 1] : undefined;
}

try {
  process.loadEnvFile(".env");
} catch {
  // Defaults apply without a .env file.
}
const args = process.argv.slice(2);
const paths = pathsFromEnv(process.env);
const model = flagValue(args, "--model") ?? "qwen2.5-0.5b";
const trainDir = join(dirname(paths.personaFile), "training");

const result = await runTraining(
  {
    activeFile: activeModelFile(paths.personaFile),
    baseRepo: trainingBaseFor(model),
    dryRun: args.includes("--dry-run"),
    iters: Number(flagValue(args, "--iters") ?? 300),
    llamaCppDir: flagValue(args, "--llama-cpp") ?? ".tools/llama.cpp",
    log: (line) => console.log(`[train] ${line}`),
    persona: loadPersona(paths.personaFile),
    python: flagValue(args, "--python") ?? ".venv-train/bin/python",
    workDir: trainDir,
  },
  processRunner({ echo: true })
);

console.log("Commands:");
for (const c of result.commands) {
  console.log(`  ${c}`);
}
console.log(
  result.promoted
    ? `Promoted ${result.gguf}. Restart the bot to use it.`
    : `Not promoted: ${result.reason}. Artifacts are in ${trainDir}.`
);
