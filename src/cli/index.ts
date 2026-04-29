#!/usr/bin/env node

import { createSampleDryRunExecutionPlan, describeProduct } from "../index.js";

const [, , command, ...args] = process.argv;

function printJson(value: unknown): void {
  console.log(`${JSON.stringify(value, null, 2)}\n`);
}

if (command === "dry-run") {
  if (args.length === 0 || (args.length === 1 && args[0] === "--sample")) {
    printJson(createSampleDryRunExecutionPlan());
    process.exit(0);
  }

  console.error("Usage: ensen-loop dry-run [--sample]");
  process.exit(1);
}

if (command === undefined) {
  console.log(describeProduct());
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
console.error("Usage: ensen-loop dry-run [--sample]");
process.exit(1);
