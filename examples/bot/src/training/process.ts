import { spawn } from "node:child_process";
import type { CommandRunner } from "./pipeline";

/** Runs commands with Node's child_process, streaming their output to the console. */
export function processRunner(opts: { echo?: boolean } = {}): CommandRunner {
  return {
    run(command, args, runOpts) {
      return new Promise((resolve, reject) => {
        const child = spawn(command, [...args], {
          cwd: runOpts?.cwd,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        const onData = (chunk: Buffer) => {
          const text = chunk.toString("utf8");
          output += text;
          if (opts.echo) {
            process.stdout.write(text);
          }
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.on("error", reject);
        child.on("close", (code) => resolve({ code: code ?? 1, output }));
      });
    },
  };
}
