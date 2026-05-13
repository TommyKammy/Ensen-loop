import type { LaneRunState, LaneRunStatus } from "../lane/index.js";
import { validateCustomerLaneEvidenceRef } from "./customer-lane-evidence.js";
import type { EvidenceBundleRef } from "./evidence-bundle-ref.js";
import { validateEvidenceBundleRef } from "./evidence-bundle-ref.js";
import type {
  RunResult,
  RunResultEvidenceBundleRef,
  RunResultErrorInfo,
  RunResultStatus,
  RunResultWarningInfo,
  VerificationSummary,
} from "./run-result.js";
import { validateRunResult } from "./run-result.js";
import type {
  RunStatusProgress,
  RunStatusSnapshot,
  RunStatusSnapshotStatus,
} from "./run-status.js";
import { validateRunStatusSnapshot } from "./run-status.js";

export interface ProjectLaneRunStatusSnapshotInput {
  readonly state: LaneRunState;
  readonly requestId: string;
  readonly correlationId: string;
  readonly observedAt: string;
  readonly protocolSchemaVersion?: string;
}

export interface ProjectLaneRunResultInput {
  readonly state: LaneRunState;
  readonly requestId: string;
  readonly correlationId: string;
  readonly completedAt: string;
  readonly evidenceBundleRefs?: readonly EvidenceBundleRef[];
  readonly protocolSchemaVersion?: string;
}

const terminalLaneStatuses = new Set<LaneRunStatus>(["completed", "failed", "blocked"]);

export function projectLaneRunStatusSnapshot(
  input: ProjectLaneRunStatusSnapshotInput,
): RunStatusSnapshot {
  assertSupportedSchemaVersion(
    input.protocolSchemaVersion ?? "eip.run-status.v1",
    "eip.run-status.v1",
  );
  assertProjectableLaneRunState(input.state);

  const status = toRunStatusSnapshotStatus(input.state.status);
  const snapshot = stripUndefined({
    schemaVersion: "eip.run-status.v1" as const,
    id: replaceProtocolIdPrefix(input.state.id, "sts"),
    requestId: input.requestId,
    correlationId: input.correlationId,
    runId: input.state.id,
    status,
    observedAt: input.observedAt,
    message: createStatusMessage(input.state.status),
    progress: createStatusProgress(input.state.status),
    extensions: createBlockedReasonsExtension(input.state),
  }) as RunStatusSnapshot;
  const validation = validateRunStatusSnapshot(snapshot);

  if (!validation.ok) {
    throw new Error(
      `Lane run state cannot be projected to RunStatusSnapshot: ${formatIssues(validation.issues)}`,
    );
  }

  return validation.snapshot;
}

export function projectLaneRunResult(input: ProjectLaneRunResultInput): RunResult {
  assertSupportedSchemaVersion(
    input.protocolSchemaVersion ?? "eip.run-result.v1",
    "eip.run-result.v1",
  );
  assertProjectableLaneRunState(input.state);

  if (!terminalLaneStatuses.has(input.state.status)) {
    throw new Error("Lane run state cannot be projected to RunResult until it is terminal.");
  }

  const resultStatus = toRunResultStatus(input.state.status);
  const evidenceBundles = resultStatus === "succeeded"
    ? projectEvidenceBundleRefs(input.state, input.correlationId, input.evidenceBundleRefs ?? [])
    : undefined;
  const blockedReasons = collectBlockedReasons(input.state);
  const result = stripUndefined({
    schemaVersion: "eip.run-result.v1" as const,
    id: input.state.id,
    requestId: input.requestId,
    correlationId: input.correlationId,
    status: resultStatus,
    completedAt: input.completedAt,
    evidenceBundles,
    verification: createProjectedVerification(input.state, resultStatus, blockedReasons),
    errors: resultStatus === "failed" ? createFailureErrors(input.state) : undefined,
    warnings: resultStatus === "blocked" ? createBlockedWarnings(blockedReasons) : undefined,
    metrics: {
      attempts: 1,
    },
    extensions: createProjectionExtensions(input.state, blockedReasons),
  }) as RunResult;
  const validation = validateRunResult(result);

  if (!validation.ok) {
    throw new Error(
      `Lane run state cannot be projected to RunResult: ${formatIssues(validation.issues)}`,
    );
  }

  return validation.result;
}

function assertSupportedSchemaVersion(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(`Unsupported EIP schema version: ${actual}. Expected ${expected}.`);
  }
}

function assertProjectableLaneRunState(state: LaneRunState): void {
  if (!isRecord(state)) {
    throw new Error("Lane run state cannot be projected because it is malformed.");
  }

  if (state.startsAgentExecution !== false) {
    throw new Error("Lane run state cannot be projected because it is malformed.");
  }

  if (
    typeof state.id !== "string" ||
    typeof state.workItemId !== "string" ||
    !isLaneRunStatus(state.status) ||
    typeof state.updatedAt !== "string" ||
    !isRecord(state.journal) ||
    state.journal.laneRunId !== state.id ||
    state.journal.workItemId !== state.workItemId ||
    !Array.isArray(state.journal.entries) ||
    !isRecord(state.evidence) ||
    !Array.isArray(state.evidence.bundleRefs) ||
    !state.evidence.bundleRefs.every((bundleRef) => typeof bundleRef === "string")
  ) {
    throw new Error("Lane run state cannot be projected because it is malformed.");
  }
}

function toRunStatusSnapshotStatus(status: LaneRunStatus): RunStatusSnapshotStatus {
  if (status === "completed") {
    return "completed";
  }

  if (status === "failed") {
    return "failed";
  }

  if (status === "blocked") {
    return "blocked";
  }

  if (status === "queued") {
    return "queued";
  }

  return "running";
}

function toRunResultStatus(status: LaneRunStatus): RunResultStatus {
  if (status === "completed") {
    return "succeeded";
  }

  if (status === "failed") {
    return "failed";
  }

  return "blocked";
}

function createStatusMessage(status: LaneRunStatus): string {
  if (status === "completed") {
    return "Local lane run completed. Retrieve final details from RunResult.";
  }

  if (status === "failed") {
    return "Local lane run failed. Retrieve final details from RunResult.";
  }

  if (status === "blocked") {
    return "Local lane run is blocked by recorded prerequisites.";
  }

  if (status === "queued") {
    return "Local lane run is queued.";
  }

  return `Local lane run is ${status}.`;
}

function createStatusProgress(status: LaneRunStatus): RunStatusProgress | undefined {
  if (status === "running") {
    return {
      current: 1,
      total: 3,
      percent: 33,
      unit: "local-lane-stages",
    };
  }

  if (status === "verifying") {
    return {
      current: 2,
      total: 3,
      percent: 67,
      unit: "local-lane-stages",
    };
  }

  if (status === "reviewing") {
    return {
      current: 3,
      total: 3,
      percent: 100,
      unit: "local-lane-stages",
    };
  }

  return undefined;
}

function createProjectedVerification(
  state: LaneRunState,
  status: RunResultStatus,
  blockedReasons: readonly string[],
): VerificationSummary {
  if (status === "succeeded") {
    return {
      status: "passed",
      summary: "Local lane run completed with persisted local evidence metadata.",
    };
  }

  if (status === "failed") {
    return {
      status: "failed",
      summary: collectFailureMessages(state).join("; ") || "Local lane run failed.",
    };
  }

  return {
    status: "blocked",
    summary: blockedReasons.join("; ") || "Local lane run is blocked.",
  };
}

function projectEvidenceBundleRefs(
  state: LaneRunState,
  correlationId: string,
  evidenceBundleRefs: readonly EvidenceBundleRef[],
): readonly RunResultEvidenceBundleRef[] | undefined {
  if (state.evidence.bundleRefs.length === 0) {
    return undefined;
  }

  const projected: RunResultEvidenceBundleRef[] = [];

  for (const uri of state.evidence.bundleRefs) {
    const evidenceBundleRef = evidenceBundleRefs.find((candidate) => candidate.uri === uri);

    if (evidenceBundleRef === undefined) {
      throw new Error("Lane run evidence cannot be projected without a matching EvidenceBundleRef.");
    }

    const validation = validateEvidenceBundleRef(evidenceBundleRef);
    if (!validation.ok) {
      throw new Error(`Lane run evidence is unsafe: ${formatIssues(validation.issues)}`);
    }

    if (validation.ref.type !== "local_path") {
      throw new Error("Lane run evidence must use a safe local EvidenceBundleRef.");
    }

    if (validation.ref.correlationId !== correlationId) {
      throw new Error("Lane run evidence correlation identifier does not match the projection input.");
    }

    const customerLaneValidation = validateCustomerLaneEvidenceRef(validation.ref);
    if (!customerLaneValidation.ok) {
      throw new Error(`Lane run evidence is unsafe: ${formatIssues(customerLaneValidation.issues)}`);
    }

    projected.push(stripUndefined({
      evidenceBundleId: validation.ref.id,
      digest: validation.ref.checksum === undefined
        ? undefined
        : `${validation.ref.checksum.algorithm}:${validation.ref.checksum.value}`,
    }));
  }

  return projected;
}

function createFailureErrors(state: LaneRunState): readonly RunResultErrorInfo[] {
  return [
    {
      code: "LOCAL_LANE_FAILED",
      message: collectFailureMessages(state).join("; ") || "Local lane run failed.",
      retryable: true,
    },
  ];
}

function createBlockedWarnings(blockedReasons: readonly string[]): readonly RunResultWarningInfo[] {
  return [
    {
      code: "LOCAL_LANE_BLOCKED",
      message: blockedReasons.join("; ") || "Local lane run is blocked.",
    },
  ];
}

function createBlockedReasonsExtension(state: LaneRunState): Record<string, unknown> | undefined {
  const blockedReasons = collectBlockedReasons(state);

  if (blockedReasons.length === 0) {
    return undefined;
  }

  return {
    "x-ensen-loop-blocked-reasons": blockedReasons,
  };
}

function createProjectionExtensions(
  state: LaneRunState,
  blockedReasons: readonly string[],
): Record<string, unknown> {
  return {
    "x-ensen-loop-lane-run-status": state.status,
    "x-ensen-loop-lane-run-revision": state.revision,
    ...(blockedReasons.length > 0
      ? {
          "x-ensen-loop-blocked-reasons": blockedReasons,
        }
      : {}),
  };
}

function collectBlockedReasons(state: LaneRunState): readonly string[] {
  return state.journal.entries
    .filter((entry) => entry.kind === "failure" && entry.message.startsWith("blocked reasons: "))
    .map((entry) => entry.message.slice("blocked reasons: ".length))
    .filter((message) => message.length > 0);
}

function collectFailureMessages(state: LaneRunState): readonly string[] {
  return state.journal.entries
    .filter((entry) => entry.kind === "failure")
    .map((entry) => entry.message)
    .filter((message) => message.length > 0);
}

function replaceProtocolIdPrefix(value: string, prefix: string): string {
  const separatorIndex = value.indexOf("_");

  if (separatorIndex < 0) {
    return `${prefix}_${value}`;
  }

  return `${prefix}_${value.slice(separatorIndex + 1)}`;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}

function formatIssues(issues: readonly { readonly path: string; readonly message: string }[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}

function isLaneRunStatus(value: unknown): value is LaneRunStatus {
  return (
    value === "queued" ||
    value === "running" ||
    value === "verifying" ||
    value === "reviewing" ||
    value === "blocked" ||
    value === "completed" ||
    value === "failed"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
