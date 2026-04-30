import type { EvidenceBundleRef } from "./evidence-bundle-ref.js";
import type { RunRequest } from "./run-request.js";
import {
  createRunRequestExecutionPlan,
  type RunRequestValidationIssue,
} from "./run-request.js";
import {
  createBlockedRunResultFromValidationIssues,
  createRunResult,
  type RunResult,
} from "./run-result.js";
import {
  createBlockedRunStatusSnapshotFromValidationIssues,
  createRunStatusSnapshot,
  type RunStatusSnapshot,
} from "./run-status.js";

export interface XGate2SmokeOutput {
  readonly schemaVersion: "ensen-loop.x-gate2-smoke.v1";
  readonly boundary: "local-cli-stdout";
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly mutatesRepository: false;
  readonly invokesProvider: false;
  readonly writesDurableEvidence: false;
  readonly statusSnapshot: RunStatusSnapshot;
  readonly runResult: RunResult;
  readonly evidenceBundleRef?: EvidenceBundleRef;
}

export function createXGate2SmokeOutput(request: RunRequest): XGate2SmokeOutput {
  const observedAt = addSeconds(request.createdAt, 1);
  const completedAt = addSeconds(request.createdAt, 2);
  const plan = createRunRequestExecutionPlan(request);
  const evidenceBundleRef = createXGate2EvidenceBundleRef(request, completedAt);
  const status = plan.status === "blocked" ? "blocked" : "queued";
  const resultStatus = plan.status === "blocked" ? "blocked" : "succeeded";

  return {
    schemaVersion: "ensen-loop.x-gate2-smoke.v1",
    boundary: "local-cli-stdout",
    requestId: request.id,
    correlationId: request.correlationId,
    mutatesRepository: false,
    invokesProvider: false,
    writesDurableEvidence: false,
    statusSnapshot: createRunStatusSnapshot(plan, {
      status,
      observedAt,
    }),
    runResult: createRunResult(plan, {
      status: resultStatus,
      completedAt,
      evidenceBundles:
        plan.status === "blocked"
          ? []
          : [{ evidenceBundleId: evidenceBundleRef.id }],
    }),
    evidenceBundleRef: plan.status === "blocked" ? undefined : evidenceBundleRef,
  };
}

export function createBlockedXGate2SmokeOutput(
  value: unknown,
  issues: readonly RunRequestValidationIssue[],
): XGate2SmokeOutput | undefined {
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
    schemaVersion: "ensen-loop.x-gate2-smoke.v1",
    boundary: "local-cli-stdout",
    requestId: statusSnapshot.requestId,
    correlationId: statusSnapshot.correlationId,
    mutatesRepository: false,
    invokesProvider: false,
    writesDurableEvidence: false,
    statusSnapshot,
    runResult,
  };
}

function createXGate2EvidenceBundleRef(
  request: RunRequest,
  createdAt: string,
): EvidenceBundleRef {
  return {
    schemaVersion: "eip.evidence-bundle-ref.v1",
    id: replaceProtocolIdPrefix(request.id, "evb"),
    correlationId: request.correlationId,
    type: "local_path",
    uri: `artifacts/evidence/x-gate2/${request.id}.json`,
    createdAt,
    contentType: "application/json",
    metadata: {
      producer: "ensen-loop",
      artifactKind: "xGate2DryRunSmoke",
      mutatesRepository: false,
      invokesProvider: false,
      writesDurableEvidence: false,
    },
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

function replaceProtocolIdPrefix(id: string, prefix: "evb"): string {
  return `${prefix}_${id.slice(id.indexOf("_") + 1)}`;
}
