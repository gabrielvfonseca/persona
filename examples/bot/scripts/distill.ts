/**
 * Writes a distilled training set: for each prompt in the training data, the teacher
 * model (the 7B GGUF) writes the reply, using the same system prompt as the original row.
 * The student (1.5B) is then trained on these replies, which are coherent and in the
 * persona's voice, unlike the small model's own attempts.
 *
 *   bun run scripts/distill.ts [teacher.gguf] [out-dir]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createGgmlNode } from "ggml-node";

const teacherPath =
  process.argv[2] ??
  "data/models/qwen7b/qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf";
const outDir = process.argv[3] ?? "data/calhau/distill";
const sourceDir = "data/calhau/training/data";

const LAUGH_WORD = /(?:a+h+a+|h+a+h+a*|k{2,}|n+b+|okok+|rs+|lol)/giu;
const EMOJI = /\p{Extended_Pictographic}/gu;

/** A reply that is mostly laughter, filler or emoji carries no voice, so it is not used for training. */
function isLaughter(reply: string): boolean {
  const withoutFiller = reply.replace(LAUGH_WORD, " ").replace(EMOJI, " ");
  const words = withoutFiller.match(/[\p{L}]{2,}/gu) ?? [];
  return words.length < 2;
}

const teacher = createGgmlNode({
  model: { path: `${process.cwd()}/${teacherPath}` } as never,
});
mkdirSync(outDir, { recursive: true });

for (const split of ["train", "valid"]) {
  const rows = readFileSync(join(sourceDir, `${split}.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  const out: string[] = [];
  let i = 0;
  for (const row of rows) {
    i += 1;
    const original =
      row.messages.find((m: { role: string }) => m.role === "system")
        ?.content ?? "";
    const system = `${original}\nAnswer what was actually said, with words. Do not reply with laughter alone (ahah, kkk, 😂) or with filler like "nbnb" or "okok" by themselves.`;
    const user =
      row.messages.find((m: { role: string }) => m.role === "user")?.content ??
      "";
    // biome-ignore lint/performance/noAwaitInLoops: one reply at a time keeps the teacher's output in row order
    const { text } = await teacher.generate({
      maxTokens: 50,
      messages: [
        { content: system, role: "system" },
        { content: user, role: "user" },
      ],
      stop: ["\n"],
      temperature: 0.6,
    } as never);
    const reply = text.trim();
    if (reply.length === 0 || isLaughter(reply)) {
      continue;
    }
    out.push(
      JSON.stringify({
        messages: [
          { content: system, role: "system" },
          { content: user, role: "user" },
          { content: reply, role: "assistant" },
        ],
      })
    );
    if (i % 50 === 0) {
      console.log(`${split}: ${i}/${rows.length}`);
    }
  }
  writeFileSync(join(outDir, `${split}.jsonl`), `${out.join("\n")}\n`);
  console.log(`${split}: wrote ${out.length} rows`);
}
await teacher.unload();
