#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import { createSampleDryRunExecutionPlan, describeProduct } from "../index.js";
import { validateRunRequest } from "../protocol/index.js";

const [, , command, ...args] = process.argv;

function printJson(value: unknown): void {
  console.log(`${JSON.stringify(value, null, 2)}\n`);
}

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function main(): Promise<void> {
  if (command === "dry-run") {
    if (args.length === 0 || (args.length === 1 && args[0] === "--sample")) {
      printJson(createSampleDryRunExecutionPlan());
      process.exit(0);
    }

    console.error("Usage: ensen-loop dry-run [--sample]");
    process.exit(1);
  }

  if (command === "run-request") {
    if (args.length !== 1) {
      console.error("Usage: ensen-loop run-request <run-request-json-file>");
      process.exit(1);
    }

    const filePath = args[0];
    if (filePath === undefined) {
      console.error("Usage: ensen-loop run-request <run-request-json-file>");
      process.exit(1);
    }

    const result = validateRunRequest(await readJsonFile(filePath));
    printJson(result);
    process.exit(result.ok ? 0 : 1);
  }

  if (command === undefined) {
    console.log(describeProduct());
    process.exit(0);
  }

  console.error(`Unknown command: ${command}`);
  console.error("Usage: ensen-loop dry-run [--sample]");
  console.error("Usage: ensen-loop run-request <run-request-json-file>");
  process.exit(1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  printJson({
    ok: false,
    issues: [
      {
        path: "$",
        message,
      },
    ],
  });
  process.exit(1);
});
