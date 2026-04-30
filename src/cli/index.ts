#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import {
  createSampleDryRunExecutionPlan,
  describeProduct,
} from "../index.js";
import {
  createBlockedRunStatusSnapshotFromValidationIssues,
  createRunRequestExecutionPlan,
  createRunStatusSnapshot,
  validateRunRequest,
} from "../protocol/index.js";
import type { CreateRunStatusSnapshotOptions } from "../protocol/index.js";

const [, , command, ...args] = process.argv;

function printJson(value: unknown): void {
  console.log(`${JSON.stringify(value, null, 2)}\n`);
}

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function main(): Promise<number> {
  if (command === "dry-run") {
    if (args.length === 0 || (args.length === 1 && args[0] === "--sample")) {
      printJson(createSampleDryRunExecutionPlan());
      return 0;
    }

    console.error("Usage: ensen-loop dry-run [--sample]");
    return 1;
  }

  if (command === "run-request") {
    if (args.length !== 1 && args.length !== 3) {
      console.error(
        "Usage: ensen-loop run-request <run-request-json-file> [--status-snapshot accepted|queued|running|blocked]",
      );
      return 1;
    }

    const filePath = args[0];
    if (filePath === undefined) {
      console.error(
        "Usage: ensen-loop run-request <run-request-json-file> [--status-snapshot accepted|queued|running|blocked]",
      );
      return 1;
    }

    const statusSnapshotMode = parseStatusSnapshotMode(args);
    if (statusSnapshotMode === false) {
      console.error(
        "Usage: ensen-loop run-request <run-request-json-file> [--status-snapshot accepted|queued|running|blocked]",
      );
      return 1;
    }

    const input = await readJsonFile(filePath);
    const result = validateRunRequest(input);

    if (statusSnapshotMode !== undefined) {
      const observedAt = new Date().toISOString();

      if (!result.ok) {
        const snapshot = createBlockedRunStatusSnapshotFromValidationIssues(
          input,
          result.issues,
          observedAt,
        );

        printJson(snapshot ?? result);
        return 1;
      }

      const plan = createRunRequestExecutionPlan(result.request);
      const status = plan.status === "blocked" ? "blocked" : statusSnapshotMode;
      printJson(createRunStatusSnapshot(plan, { status, observedAt }));
      return plan.status === "blocked" ? 1 : 0;
    }

    printJson(result);
    return result.ok ? 0 : 1;
  }

  if (command === undefined) {
    console.log(describeProduct());
    return 0;
  }

  console.error(`Unknown command: ${command}`);
  console.error("Usage: ensen-loop dry-run [--sample]");
  console.error(
    "Usage: ensen-loop run-request <run-request-json-file> [--status-snapshot accepted|queued|running|blocked]",
  );
  return 1;
}

function parseStatusSnapshotMode(
  args: readonly string[],
): CreateRunStatusSnapshotOptions["status"] | undefined | false {
  if (args.length === 1) {
    return undefined;
  }

  const [, flag, status] = args;
  if (
    flag === "--status-snapshot" &&
    (status === "accepted" ||
      status === "queued" ||
      status === "running" ||
      status === "blocked")
  ) {
    return status;
  }

  return false;
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
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
    process.exitCode = 1;
  });
