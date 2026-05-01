#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  createSampleDryRunExecutionPlan,
  describeProduct,
} from "../index.js";
import {
  createDeterministicLocalFakeExecutor,
  invokeLaneExecutor,
  persistLaneExecutorResult,
} from "../executor/index.js";
import type { LocalFakeExecutorOutcome } from "../executor/index.js";
import {
  prepareLocalLaneWorkspace,
} from "../lane/index.js";
import {
  createBlockedRunResultFromValidationIssues,
  createBlockedRunStatusSnapshotFromValidationIssues,
  createBlockedXGate2SmokeOutput,
  createRunRequestExecutionPlan,
  createRunResult,
  createRunStatusSnapshot,
  createXGate2SmokeOutput,
  projectLaneRunResult,
  projectLaneRunStatusSnapshot,
  validateRunRequest,
} from "../protocol/index.js";
import type { RunRequestValidationIssue } from "../protocol/index.js";
import type { CreateRunResultOptions } from "../protocol/index.js";
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
        "Usage: ensen-loop run-request <run-request-json-file> [--status-snapshot accepted|queued|running|blocked|--run-result succeeded|failed|blocked]",
      );
      return 1;
    }

    const filePath = args[0];
    if (filePath === undefined) {
      console.error(
        "Usage: ensen-loop run-request <run-request-json-file> [--status-snapshot accepted|queued|running|blocked|--run-result succeeded|failed|blocked]",
      );
      return 1;
    }

    const statusSnapshotMode = parseStatusSnapshotMode(args);
    const runResultMode = parseRunResultMode(args);
    if (
      statusSnapshotMode === false ||
      runResultMode === false ||
      (statusSnapshotMode !== undefined && runResultMode !== undefined)
    ) {
      console.error(
        "Usage: ensen-loop run-request <run-request-json-file> [--status-snapshot accepted|queued|running|blocked|--run-result succeeded|failed|blocked]",
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

    if (runResultMode !== undefined) {
      const completedAt = new Date().toISOString();

      if (!result.ok) {
        const runResult = createBlockedRunResultFromValidationIssues(
          input,
          result.issues,
          completedAt,
        );

        printJson(runResult ?? result);
        return 1;
      }

      const plan = createRunRequestExecutionPlan(result.request);
      const status = plan.status === "blocked" ? "blocked" : runResultMode;
      printJson(createRunResult(plan, { status, completedAt }));
      return plan.status === "blocked" || status === "failed" ? 1 : 0;
    }

    printJson(result);
    return result.ok ? 0 : 1;
  }

  if (command === "x-gate2-smoke") {
    if (args.length !== 1) {
      console.error("Usage: ensen-loop x-gate2-smoke <run-request-json-file>");
      return 1;
    }

    const filePath = args[0];
    if (filePath === undefined) {
      console.error("Usage: ensen-loop x-gate2-smoke <run-request-json-file>");
      return 1;
    }

    const input = await readJsonFile(filePath);
    const result = validateRunRequest(input);

    if (!result.ok) {
      const output = createBlockedXGate2SmokeOutput(input, result.issues);

      printJson(output ?? result);
      return 1;
    }

    const output = createXGate2SmokeOutput(result.request);

    printJson(output);
    return output.runResult.status === "succeeded" ? 0 : 1;
  }

  if (command === "x-gate3-smoke") {
    const options = parseXGate3SmokeArgs(args);
    if (options === undefined) {
      console.error(
        "Usage: ensen-loop x-gate3-smoke <run-request-json-file> --workspace-root <workspace-root> --state-root <state-root> [--fixture succeeded|failed|blocked]",
      );
      return 1;
    }

    const input = await readJsonFile(options.filePath);
    const result = validateRunRequest(input);

    if (!result.ok) {
      const output = createBlockedXGate3SmokeOutput(input, result.issues);

      printJson(output ?? result);
      return 1;
    }

    const plan = createRunRequestExecutionPlan(result.request);
    const laneRunId = replaceProtocolIdPrefix(result.request.id, "run");
    const observedAt = addSeconds(result.request.createdAt, 1);
    const completedAt = addSeconds(result.request.createdAt, 2);
    const recordedAt = addSeconds(result.request.createdAt, 3);

    const prepared = await prepareLocalLaneWorkspace({
      workspaceRoot: options.workspaceRoot,
      stateRoot: options.stateRoot,
      laneRunId,
      workItemId: result.request.workItem.workItemId,
    });
    const preparedContext = {
      laneRunId,
      workspacePath: prepared.workspacePath,
      statePath: prepared.statePath,
    };
    const executorResult = await invokeLaneExecutor({
      executor: createDeterministicLocalFakeExecutor(),
      mode: "deterministic-local-fake",
      plan,
      preparedContext,
      completedAt,
      fixture: createXGate3Fixture(options.fixture),
    });
    const persisted = await persistLaneExecutorResult({
      stateRoot: options.stateRoot,
      plan,
      preparedContext,
      executorResult,
      recordedAt,
    });
    const statusSnapshot = projectLaneRunStatusSnapshot({
      state: persisted.state,
      requestId: result.request.id,
      correlationId: result.request.correlationId,
      observedAt,
    });
    const runResult = projectLaneRunResult({
      state: persisted.state,
      requestId: result.request.id,
      correlationId: result.request.correlationId,
      completedAt,
      evidenceBundleRefs: persisted.evidenceBundleRefs,
    });
    const output = {
      schemaVersion: "ensen-loop.x-gate3-local-lane-smoke.v1",
      boundary: "local-cli-bounded-fake-lane",
      requestId: result.request.id,
      correlationId: result.request.correlationId,
      mutatesRepository: false,
      invokesProvider: false,
      startsAgentProviderSession: false,
      writesProductionEvidenceArchive: false,
      statusSnapshot,
      runResult,
      localArtifacts: {
        laneRunId,
        stateFile: toPortableRelativePath(options.stateRoot, persisted.statePath),
        evidenceMetadata: persisted.evidenceMetadataPaths.map((metadataPath) =>
          toPortableRelativePath(options.stateRoot, metadataPath),
        ),
      },
    };

    printJson(output);
    return runResult.status === "succeeded" ? 0 : 1;
  }

  if (command === undefined) {
    console.log(describeProduct());
    return 0;
  }

  console.error(`Unknown command: ${command}`);
  console.error("Usage: ensen-loop dry-run [--sample]");
  console.error(
    "Usage: ensen-loop run-request <run-request-json-file> [--status-snapshot accepted|queued|running|blocked|--run-result succeeded|failed|blocked]",
  );
  console.error("Usage: ensen-loop x-gate2-smoke <run-request-json-file>");
  console.error(
    "Usage: ensen-loop x-gate3-smoke <run-request-json-file> --workspace-root <workspace-root> --state-root <state-root> [--fixture succeeded|failed|blocked]",
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
  if (flag === "--run-result") {
    return undefined;
  }

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

function parseRunResultMode(
  args: readonly string[],
): CreateRunResultOptions["status"] | undefined | false {
  if (args.length === 1) {
    return undefined;
  }

  const [, flag, status] = args;
  if (flag === "--status-snapshot") {
    return undefined;
  }

  if (
    flag === "--run-result" &&
    (status === "succeeded" || status === "failed" || status === "blocked")
  ) {
    return status;
  }

  return false;
}

interface XGate3SmokeOptions {
  readonly filePath: string;
  readonly workspaceRoot: string;
  readonly stateRoot: string;
  readonly fixture: LocalFakeExecutorOutcome;
}

function parseXGate3SmokeArgs(args: readonly string[]): XGate3SmokeOptions | undefined {
  const [filePath, ...optionArgs] = args;

  if (filePath === undefined) {
    return undefined;
  }

  let workspaceRoot: string | undefined;
  let stateRoot: string | undefined;
  let fixture: LocalFakeExecutorOutcome = "succeeded";

  for (let index = 0; index < optionArgs.length; index += 2) {
    const flag = optionArgs[index];
    const value = optionArgs[index + 1];

    if (value === undefined) {
      return undefined;
    }

    if (flag === "--workspace-root") {
      workspaceRoot = value;
      continue;
    }

    if (flag === "--state-root") {
      stateRoot = value;
      continue;
    }

    if (
      flag === "--fixture" &&
      (value === "succeeded" || value === "failed" || value === "blocked")
    ) {
      fixture = value;
      continue;
    }

    return undefined;
  }

  if (workspaceRoot === undefined || stateRoot === undefined) {
    return undefined;
  }

  return {
    filePath,
    workspaceRoot,
    stateRoot,
    fixture,
  };
}

function createXGate3Fixture(outcome: LocalFakeExecutorOutcome) {
  return {
    name: `x-gate3-${outcome}`,
    outcome,
    verificationSummary:
      outcome === "succeeded"
        ? "x-gate3 local fake lane smoke completed"
        : outcome === "failed"
          ? "x-gate3 local fake lane smoke failed by fixture"
          : undefined,
    blockedReasons:
      outcome === "blocked"
        ? ["x-gate3 local fake lane smoke blocked by fixture"]
        : undefined,
  };
}

function createBlockedXGate3SmokeOutput(
  value: unknown,
  issues: readonly RunRequestValidationIssue[],
): Record<string, unknown> | undefined {
  const observedAt = addSeconds(extractCreatedAt(value), 1);
  const completedAt = addSeconds(extractCreatedAt(value), 2);
  const statusSnapshot = createBlockedRunStatusSnapshotFromValidationIssues(
    value,
    issues,
    observedAt,
  );
  const runResult = createBlockedRunResultFromValidationIssues(value, issues, completedAt);

  if (statusSnapshot === undefined || runResult === undefined) {
    return undefined;
  }

  return {
    schemaVersion: "ensen-loop.x-gate3-local-lane-smoke.v1",
    boundary: "local-cli-bounded-fake-lane",
    requestId: statusSnapshot.requestId,
    correlationId: statusSnapshot.correlationId,
    mutatesRepository: false,
    invokesProvider: false,
    startsAgentProviderSession: false,
    writesProductionEvidenceArchive: false,
    statusSnapshot,
    runResult,
  };
}

function extractCreatedAt(value: unknown): string {
  if (
    value !== null &&
    typeof value === "object" &&
    "createdAt" in value &&
    typeof value.createdAt === "string"
  ) {
    return value.createdAt;
  }

  return "1970-01-01T00:00:00Z";
}

function addSeconds(timestamp: string, seconds: number): string {
  const milliseconds = Date.parse(timestamp);

  if (!Number.isFinite(milliseconds)) {
    return addSeconds("1970-01-01T00:00:00Z", seconds);
  }

  return new Date(milliseconds + seconds * 1000).toISOString().replace(".000Z", "Z");
}

function replaceProtocolIdPrefix(id: string, prefix: "run"): string {
  return `${prefix}_${id.slice(id.indexOf("_") + 1)}`;
}

function toPortableRelativePath(root: string, filePath: string): string {
  return path.relative(path.resolve(root), filePath).split(path.sep).join("/");
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
