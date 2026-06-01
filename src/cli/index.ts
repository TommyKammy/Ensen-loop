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
  explainLaneRun,
  getLaneRunStatus,
  planLoopMode,
  prepareLocalLaneWorkspace,
  reconcileLaneRunState,
  requeueLaneRun,
  retryLaneRun,
  stopLaneRun,
} from "../lane/index.js";
import type { ReconcileLaneRunStateInput } from "../lane/index.js";
import type { LaneRunOperatorActionResult, LaneRunReconciliationResult } from "../lane/index.js";
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
import { sanitizeCliErrorMessage } from "./diagnostics.js";

const [, , command, ...args] = process.argv;

function printJson(value: unknown): void {
  console.log(`${JSON.stringify(value, null, 2)}\n`);
}

function projectLaneRunOperatorActionCliResult(result: LaneRunOperatorActionResult): unknown {
  return {
    ok: result.ok,
    action: result.action,
    stableWorkItemId: result.stableWorkItemId,
    laneRunId: result.laneRunId,
    publicDiagnostics: result.publicDiagnostics,
    lineage: {
      relationship: result.lineage.relationship,
      previousLaneRunId: result.lineage.previousLaneRunId,
      newQueueRecordId: result.lineage.newQueueRecordId,
      preservedEvidenceRefCount: result.lineage.preservedEvidenceRefs.length,
    },
  };
}

function projectLaneRunReconciliationCliResult(result: LaneRunReconciliationResult): unknown {
  return {
    schemaVersion: result.schemaVersion,
    state: result.state,
    category: result.category,
    stableWorkItemId: result.stableWorkItemId,
    laneRunId: result.laneRunId,
    observedAt: result.observedAt,
    publicDiagnostics: result.publicDiagnostics,
    nextOperatorAction: result.nextOperatorAction,
    mismatches: result.mismatches,
    evidence: {
      bundleRefCount: result.evidence.bundleRefs.length,
    },
    queue: result.queue,
    lock: result.lock,
    startsAgentExecution: result.startsAgentExecution,
  };
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

  if (command === "status") {
    const options = parseStatusArgs(args);

    if (options === undefined) {
      console.error("Usage: ensen-loop status --state-root <state-root>");
      return 1;
    }

    const status = await getLaneRunStatus(options.stateRoot);

    printJson(status);
    return status.state === "ok" ? 0 : 1;
  }

  if (command === "explain") {
    const options = parseExplainArgs(args);

    if (options === undefined) {
      console.error("Usage: ensen-loop explain --state-root <state-root> [--issue <stable-work-item-id>]");
      return 1;
    }

    const explanation = await explainLaneRun(options.stateRoot, {
      stableWorkItemId: options.stableWorkItemId,
    });

    printJson(explanation);
    return explanation.state === "ok" ? 0 : 1;
  }

  if (command === "loop-mode") {
    const options = parseLoopModeArgs(args);

    if (options === undefined) {
      console.error(
        "Usage: ensen-loop loop-mode one-shot --state-root <state-root> --issue <stable-work-item-id>",
      );
      console.error("Usage: ensen-loop loop-mode continuous --state-root <state-root>");
      console.error("X-Gate 4 dogfood is owner-controlled only and does not authorize customer repo execution.");
      return 1;
    }

    const plan = await planLoopMode(options.stateRoot, {
      mode: options.mode,
      stableWorkItemId: options.stableWorkItemId,
      invokedBy: "local-operator",
    });

    printJson(plan);
    return plan.state === "ready" ? 0 : 1;
  }

  if (command === "reconcile") {
    const options = parseReconcileArgs(args);

    if (options === undefined) {
      console.error(
        "Usage: ensen-loop reconcile --state-root <state-root> --issue <stable-work-item-id> [--lane-run <lane-run-id>] --observed-at <iso-timestamp> --surfaces <surfaces-json-file>",
      );
      return 1;
    }

    const surfaces = await readJsonFile(options.surfacesPath);
    const result = await reconcileLaneRunState(options.stateRoot, {
      stableWorkItemId: options.stableWorkItemId,
      laneRunId: options.laneRunId,
      observedAt: options.observedAt,
      surfaces,
    } as ReconcileLaneRunStateInput);

    printJson(projectLaneRunReconciliationCliResult(result));
    return result.state === "ok" ? 0 : 1;
  }

  if (command === "stop" || command === "retry" || command === "requeue") {
    const options = parseOperatorActionArgs(args);

    if (options === undefined) {
      console.error(
        `Usage: ensen-loop ${command} --state-root <state-root> --issue <stable-work-item-id> --lane-run <lane-run-id> --reason <public-reason>`,
      );
      return 1;
    }

    const actedAt = new Date().toISOString();
    const result =
      command === "stop"
        ? await stopLaneRun(options.stateRoot, {
            stableWorkItemId: options.stableWorkItemId,
            laneRunId: options.laneRunId,
            reason: options.reason,
            actedAt,
          })
        : command === "retry"
          ? await retryLaneRun(options.stateRoot, {
              stableWorkItemId: options.stableWorkItemId,
              laneRunId: options.laneRunId,
              reason: options.reason,
              actedAt,
            })
          : await requeueLaneRun(options.stateRoot, {
              stableWorkItemId: options.stableWorkItemId,
              laneRunId: options.laneRunId,
              reason: options.reason,
              actedAt,
            });

    printJson(projectLaneRunOperatorActionCliResult(result));
    return result.ok ? 0 : 1;
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
  console.error("Usage: ensen-loop status --state-root <state-root>");
  console.error("Usage: ensen-loop explain --state-root <state-root> [--issue <stable-work-item-id>]");
  console.error(
    "Usage: ensen-loop loop-mode one-shot --state-root <state-root> --issue <stable-work-item-id>",
  );
  console.error("Usage: ensen-loop loop-mode continuous --state-root <state-root>");
  console.error("X-Gate 4 dogfood is owner-controlled only and does not authorize customer repo execution.");
  console.error(
    "Usage: ensen-loop reconcile --state-root <state-root> --issue <stable-work-item-id> [--lane-run <lane-run-id>] --observed-at <iso-timestamp> --surfaces <surfaces-json-file>",
  );
  console.error(
    "Usage: ensen-loop stop|retry|requeue --state-root <state-root> --issue <stable-work-item-id> --lane-run <lane-run-id> --reason <public-reason>",
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

interface StatusOptions {
  readonly stateRoot: string;
}

function parseStatusArgs(args: readonly string[]): StatusOptions | undefined {
  if (args.length !== 2 || args[0] !== "--state-root" || args[1] === undefined) {
    return undefined;
  }

  return {
    stateRoot: args[1],
  };
}

interface ExplainOptions {
  readonly stateRoot: string;
  readonly stableWorkItemId?: string;
}

function parseExplainArgs(args: readonly string[]): ExplainOptions | undefined {
  if (args.length !== 2 && args.length !== 4) {
    return undefined;
  }

  if (args[0] !== "--state-root" || args[1] === undefined) {
    return undefined;
  }

  if (args.length === 2) {
    return {
      stateRoot: args[1],
    };
  }

  if (args[2] !== "--issue" || args[3] === undefined) {
    return undefined;
  }

  return {
    stateRoot: args[1],
    stableWorkItemId: args[3],
  };
}

interface LoopModeOptions {
  readonly mode: "one-shot" | "continuous";
  readonly stateRoot: string;
  readonly stableWorkItemId?: string;
}

function parseLoopModeArgs(args: readonly string[]): LoopModeOptions | undefined {
  const [mode, ...optionArgs] = args;

  if (mode !== "one-shot" && mode !== "continuous") {
    return undefined;
  }

  const values = new Map<string, string>();

  for (let index = 0; index < optionArgs.length; index += 2) {
    const flag = optionArgs[index];
    const value = optionArgs[index + 1];

    if (flag === undefined || value === undefined || !flag.startsWith("--")) {
      return undefined;
    }

    values.set(flag, value);
  }

  const stateRoot = values.get("--state-root");
  const stableWorkItemId = values.get("--issue");

  if (stateRoot === undefined) {
    return undefined;
  }

  if (mode === "one-shot") {
    if (stableWorkItemId === undefined || values.size !== 2) {
      return undefined;
    }

    return {
      mode,
      stateRoot,
      stableWorkItemId,
    };
  }

  if (stableWorkItemId !== undefined || values.size !== 1) {
    return undefined;
  }

  return {
    mode,
    stateRoot,
  };
}

interface OperatorActionOptions {
  readonly stateRoot: string;
  readonly stableWorkItemId: string;
  readonly laneRunId: string;
  readonly reason: string;
}

interface ReconcileOptions {
  readonly stateRoot: string;
  readonly stableWorkItemId: string;
  readonly laneRunId?: string;
  readonly observedAt: string;
  readonly surfacesPath: string;
}

function parseReconcileArgs(args: readonly string[]): ReconcileOptions | undefined {
  if (args.length !== 8 && args.length !== 10) {
    return undefined;
  }

  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];

    if (flag === undefined || value === undefined || !flag.startsWith("--")) {
      return undefined;
    }

    values.set(flag, value);
  }

  const stateRoot = values.get("--state-root");
  const stableWorkItemId = values.get("--issue");
  const laneRunId = values.get("--lane-run");
  const observedAt = values.get("--observed-at");
  const surfacesPath = values.get("--surfaces");

  if (
    stateRoot === undefined ||
    stableWorkItemId === undefined ||
    observedAt === undefined ||
    surfacesPath === undefined ||
    values.size !== (laneRunId === undefined ? 4 : 5)
  ) {
    return undefined;
  }

  return {
    stateRoot,
    stableWorkItemId,
    laneRunId,
    observedAt,
    surfacesPath,
  };
}

function parseOperatorActionArgs(args: readonly string[]): OperatorActionOptions | undefined {
  if (args.length !== 8) {
    return undefined;
  }

  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];

    if (flag === undefined || value === undefined || !flag.startsWith("--")) {
      return undefined;
    }

    values.set(flag, value);
  }

  const stateRoot = values.get("--state-root");
  const stableWorkItemId = values.get("--issue");
  const laneRunId = values.get("--lane-run");
  const reason = values.get("--reason");

  if (
    stateRoot === undefined ||
    stableWorkItemId === undefined ||
    laneRunId === undefined ||
    reason === undefined ||
    values.size !== 4
  ) {
    return undefined;
  }

  return {
    stateRoot,
    stableWorkItemId,
    laneRunId,
    reason,
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
    const rawMessage = error instanceof Error ? error.message : String(error);
    const message = sanitizeCliErrorMessage(rawMessage);
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
