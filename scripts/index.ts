#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { checkDeps, listPackages } from "./packages";
import { setup } from "./setup";

const usage = `Usage: bun scripts/index.ts <command>

Commands:
  setup         Install dependencies and create examples/bot/.env from its template
  packages      List the workspace packages and their scripts
  check-deps    Check that packages/* only depend on the packages they are allowed to
  help          Show this message`;

const { positionals } = parseArgs({ allowPositionals: true, strict: false });
const [command = "help"] = positionals;

switch (command) {
  case "setup":
    setup();
    break;
  case "packages":
    listPackages();
    break;
  case "check-deps":
    checkDeps();
    break;
  case "help":
    console.log(usage);
    break;
  default:
    console.error(`Unknown command: ${command}\n`);
    console.error(usage);
    process.exitCode = 1;
}
