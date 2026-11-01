import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Persona } from "@persona/schemas";
import {
  type ActiveModel,
  readActiveModel,
  writeActiveModel,
} from "../active-model";
import { buildDataset, toJsonl } from "./dataset";
import { decidePromotion, parseValLosses } from "./evaluate";

/** Runs one external command and returns its combined output. */
export interface CommandRunner {
  run: (
    command: string,
    args: readonly string[],
    opts?: { cwd?: string | undefined }
  ) => Promise<{ code: number; output: string }>;
}

export interface TrainOptions {
  /** Record of the active model. Promotion writes here. */
  activeFile: string;
  /** Hugging Face repo of the full-precision base model. */
  baseRepo: string;
  batchSize?: number | undefined;
  /** Dry run prints the plan and writes the dataset, but runs no command. */
  dryRun?: boolean | undefined;
  iters?: number | undefined;
  learningRate?: number | undefined;
  /** Checkout of llama.cpp, used for its GGUF converter. */
  llamaCppDir: string;
  log?: (line: string) => void;
  now?: () => Date;
  numLayers?: number | undefined;
  persona: Persona;
  /** Path to the Python that has mlx-lm and gguf installed. */
  python: string;
  /** Where datasets, adapters, fused weights and the GGUF file are written. */
  workDir: string;
}

export interface TrainResult {
  baseLoss?: number | undefined;
  bestLoss?: number | undefined;
  commands: string[];
  gguf: string;
  promoted: boolean;
  reason: string;
}

/**
 * Fine-tunes the base model on the persona's example exchanges, and promotes
 * the result only when it beats the base and the active model. Steps:
 *   1. write the dataset (train and valid, chat format)
 *   2. LoRA training with mlx-lm (Apple Silicon)
 *   3. fuse the adapter into full weights
 *   4. convert to GGUF with llama.cpp, so ggml-node can load it
 *   5. promote if the validation loss is better
 */
export async function runTraining(
  opts: TrainOptions,
  runner: CommandRunner
): Promise<TrainResult> {
  const log =
    opts.log ??
    (() => {
      /* intentionally empty */
    });
  const iters = opts.iters ?? 300;
  const workDir = resolve(opts.workDir);
  const dataDir = join(workDir, "data");
  const adapterDir = join(workDir, "adapter");
  const fusedDir = join(workDir, "fused");
  const gguf = join(workDir, "persona-q8_0.gguf");
  const converter = join(resolve(opts.llamaCppDir), "convert_hf_to_gguf.py");

  const dataset = buildDataset(opts.persona);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, "train.jsonl"), toJsonl(dataset.train));
  writeFileSync(join(dataDir, "valid.jsonl"), toJsonl(dataset.valid));
  log(
    `dataset: ${dataset.train.length} train, ${dataset.valid.length} valid rows`
  );

  const steps: { name: string; command: string; args: string[] }[] = [
    {
      args: [
        "-m",
        "mlx_lm",
        "lora",
        "--model",
        opts.baseRepo,
        "--train",
        "--data",
        dataDir,
        "--iters",
        String(iters),
        "--batch-size",
        String(opts.batchSize ?? 2),
        "--learning-rate",
        String(opts.learningRate ?? 1e-4),
        "--num-layers",
        String(opts.numLayers ?? 8),
        "--steps-per-eval",
        String(Math.max(10, Math.floor(iters / 10))),
        "--val-batches",
        "4",
        // Learn the replies, not the system prompt they are shown under.
        "--mask-prompt",
        "--adapter-path",
        adapterDir,
      ],
      command: opts.python,
      name: "lora",
    },
    {
      args: [
        "-m",
        "mlx_lm",
        "fuse",
        "--model",
        opts.baseRepo,
        "--adapter-path",
        adapterDir,
        "--save-path",
        fusedDir,
      ],
      command: opts.python,
      name: "fuse",
    },
    {
      args: [converter, fusedDir, "--outtype", "q8_0", "--outfile", gguf],
      command: opts.python,
      name: "gguf",
    },
  ];
  const commands = steps.map((s) => [s.command, ...s.args].join(" "));

  if (opts.dryRun) {
    log("dry run: commands not executed");
    return { commands, gguf, promoted: false, reason: "dry run" };
  }

  let lossOutput = "";
  for (const step of steps) {
    log(`step ${step.name}`);
    // biome-ignore lint/performance/noAwaitInLoops: each training step depends on the one before it
    const res = await runner.run(step.command, step.args, { cwd: workDir });
    if (step.name === "lora") {
      lossOutput = res.output;
    }
    if (res.code !== 0) {
      throw new Error(
        `Training step "${step.name}" failed with exit code ${res.code}.`
      );
    }
  }

  const losses = parseValLosses(lossOutput);
  const [baseLoss] = losses;
  const bestLoss = losses.length ? Math.min(...losses) : Number.NaN;
  const active = readActiveModel(opts.activeFile);
  const decision = decidePromotion({
    activeLoss: active?.valLoss,
    baseLoss: baseLoss ?? Number.NaN,
    bestLoss,
  });
  log(decision.reason);

  if (decision.promote) {
    const record: ActiveModel = {
      baseModel: opts.baseRepo,
      path: gguf,
      promotedAt: (opts.now?.() ?? new Date()).toISOString(),
      valLoss: bestLoss,
    };
    writeActiveModel(opts.activeFile, record);
  }
  return {
    baseLoss,
    bestLoss,
    commands,
    gguf,
    promoted: decision.promote,
    reason: decision.reason,
  };
}
