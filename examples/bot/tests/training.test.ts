import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Persona } from "@persona/schemas";
import { describe, expect, it } from "vitest";
import {
  readActiveModel,
  resolveModelValue,
  writeActiveModel,
} from "../src/active-model";
import { pathsFromEnv } from "../src/config";
import { isRegistryModel, REGISTRY_MODELS, toModelSource } from "../src/model";
import {
  buildDataset,
  type CommandRunner,
  decidePromotion,
  parseValLosses,
  runTraining,
  trainingBaseFor,
} from "../src/training";

const PATTERN_1 = /at least 20/u;
const PATTERN_2 = /fuse/u;
const PATTERN_3 = /Unknown model/u;
const PATTERN_4 = /qwen2.5-0.5b and qwen2.5-1.5b/u;

function persona(exchanges: number): Persona {
  return {
    exchanges: Array.from({ length: exchanges }, (_, i) => ({
      assistant: `a${i}`,
      user: `q${i}`,
    })),
    facts: [],
    name: "Ana",
    phrases: [],
    quotes: [],
    stats: { medianLen: 5, p90Len: 9 },
    styleGuide: "Short.",
    version: 1,
  };
}

describe("buildDataset", () => {
  it("refuses to train on too few exchanges", () => {
    expect(() => buildDataset(persona(5))).toThrow(PATTERN_1);
  });
  it("splits deterministically and puts the persona system prompt on every row", () => {
    const ds = buildDataset(persona(40));
    expect(ds.valid).toHaveLength(4);
    expect(ds.train).toHaveLength(36);
    expect(ds.train[0]?.messages[0]).toEqual({
      content: ds.systemPrompt,
      role: "system",
    });
    expect(ds.systemPrompt).toContain("You are Ana.");
  });
});

describe("parseValLosses", () => {
  it("reads the validation losses mlx-lm prints, in order", () => {
    const out =
      "  1    val 6.347    3.71s\n  10    val 0.216    0.15s\nTrained\n  30 val 0.048";
    expect(parseValLosses(out)).toEqual([6.347, 0.216, 0.048]);
  });
});

describe("decidePromotion", () => {
  it("promotes only a model that beats the base and the active model", () => {
    expect(decidePromotion({ baseLoss: 6, bestLoss: 0.5 }).promote).toBe(true);
    expect(decidePromotion({ baseLoss: 6, bestLoss: 5.999 }).promote).toBe(
      false
    );
    expect(
      decidePromotion({ activeLoss: 0.3, baseLoss: 6, bestLoss: 0.5 }).promote
    ).toBe(false);
    expect(decidePromotion({ baseLoss: 6, bestLoss: Number.NaN }).promote).toBe(
      false
    );
  });
});

describe("runTraining", () => {
  function fakeRunner(losses: string, codes: number[] = [0, 0, 0]) {
    const calls: { command: string; args: readonly string[] }[] = [];
    let i = 0;
    const runner: CommandRunner = {
      run(command, args) {
        calls.push({ args, command });
        const code = codes[i] ?? 0;
        i += 1;
        return Promise.resolve({ code, output: i === 1 ? losses : "" });
      },
    };
    return { calls, runner };
  }

  it("lists the commands in a dry run and runs none", async () => {
    const dir = mkdtempSync(join(tmpdir(), "train-"));
    const { runner, calls } = fakeRunner("");
    const result = await runTraining(
      {
        activeFile: join(dir, "active.json"),
        baseRepo: "Qwen/Qwen2.5-0.5B-Instruct",
        dryRun: true,
        llamaCppDir: "llama",
        persona: persona(40),
        python: "py",
        workDir: dir,
      },
      runner
    );
    expect(calls).toHaveLength(0);
    expect(result.commands[0]).toContain("mlx_lm lora");
    expect(result.commands[1]).toContain("mlx_lm fuse");
    expect(result.commands[2]).toContain("convert_hf_to_gguf.py");
    expect(existsSync(join(dir, "data", "train.jsonl"))).toBe(true);
  });

  it("promotes the result and records it when validation improves", async () => {
    const dir = mkdtempSync(join(tmpdir(), "train-"));
    const active = join(dir, "active.json");
    const { runner } = fakeRunner("  1 val 6.0\n  10 val 0.4\n");
    const result = await runTraining(
      {
        activeFile: active,
        baseRepo: "base",
        llamaCppDir: "llama",
        now: () => new Date("2026-10-31T00:00:00Z"),
        persona: persona(40),
        python: "py",
        workDir: dir,
      },
      runner
    );
    expect(result.promoted).toBe(true);
    expect(readActiveModel(active)).toMatchObject({
      baseModel: "base",
      path: result.gguf,
      valLoss: 0.4,
    });
  });

  it("does not promote when validation did not improve", async () => {
    const dir = mkdtempSync(join(tmpdir(), "train-"));
    const active = join(dir, "active.json");
    const { runner } = fakeRunner("  1 val 0.5\n  10 val 0.499\n");
    const result = await runTraining(
      {
        activeFile: active,
        baseRepo: "base",
        llamaCppDir: "llama",
        persona: persona(40),
        python: "py",
        workDir: dir,
      },
      runner
    );
    expect(result.promoted).toBe(false);
    expect(existsSync(active)).toBe(false);
  });

  it("stops at the first failing step", async () => {
    const dir = mkdtempSync(join(tmpdir(), "train-"));
    const { runner, calls } = fakeRunner("  1 val 6.0\n", [0, 1]);
    await expect(
      runTraining(
        {
          activeFile: join(dir, "a.json"),
          baseRepo: "base",
          llamaCppDir: "llama",
          persona: persona(40),
          python: "py",
          workDir: dir,
        },
        runner
      )
    ).rejects.toThrow(PATTERN_2);
    expect(calls).toHaveLength(2);
  });
});

describe("model selection", () => {
  it("accepts registry ids and .gguf paths, and rejects anything else", () => {
    for (const id of REGISTRY_MODELS) {
      expect(isRegistryModel(id)).toBe(true);
    }
    expect(toModelSource("qwen2.5-1.5b")).toBe("qwen2.5-1.5b");
    expect(toModelSource("/models/persona.gguf")).toEqual({
      path: "/models/persona.gguf",
    });
    expect(() => toModelSource("gpt-4")).toThrow(PATTERN_3);
  });
  it("prefers PERSONA_MODEL, then the active fine-tune, then the default", () => {
    const dir = mkdtempSync(join(tmpdir(), "active-"));
    const file = join(dir, "active.json");
    expect(resolveModelValue(undefined, file)).toBe("qwen2.5-0.5b");
    writeActiveModel(file, {
      baseModel: "b",
      path: "/m/x.gguf",
      promotedAt: "t",
      valLoss: 0.1,
    });
    expect(resolveModelValue(undefined, file)).toBe("/m/x.gguf");
    expect(resolveModelValue("qwen2.5-1.5b", file)).toBe("qwen2.5-1.5b");
  });
  it("maps the two trainable models to their Hugging Face repos", () => {
    expect(trainingBaseFor("qwen2.5-0.5b")).toBe("Qwen/Qwen2.5-0.5B-Instruct");
    expect(() => trainingBaseFor("smollm2-360m")).toThrow(PATTERN_4);
  });
  it("reads data paths with the same defaults as the schema", () => {
    expect(pathsFromEnv({})).toEqual({
      personaFile: "data/persona.json",
    });
  });
});
