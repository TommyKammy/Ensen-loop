import type { RunRequestExecutionPlan, RunRequestValidationIssue } from "./run-request.js";

export type RunStatusSnapshotStatus =
  | "accepted"
  | "queued"
  | "running"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "failed"
  | "blocked"
  | "unknown";

export interface RunStatusProgress {
  readonly current?: number;
  readonly total?: number;
  readonly percent?: number;
  readonly unit?: string;
}

export interface RunStatusSnapshot {
  readonly schemaVersion: "eip.run-status.v1";
  readonly id: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly runId?: string;
  readonly status: RunStatusSnapshotStatus;
  readonly observedAt: string;
  readonly message?: string;
  readonly progress?: RunStatusProgress;
  readonly extensions?: Record<string, unknown>;
}

export interface CreateRunStatusSnapshotOptions {
  readonly status: "accepted" | "queued" | "running" | "blocked";
  readonly observedAt: string;
}

export interface RunStatusSnapshotValidationSuccess {
  readonly ok: true;
  readonly snapshot: RunStatusSnapshot;
}

export interface RunStatusSnapshotValidationFailure {
  readonly ok: false;
  readonly issues: readonly RunRequestValidationIssue[];
}

export type RunStatusSnapshotValidationResult =
  | RunStatusSnapshotValidationSuccess
  | RunStatusSnapshotValidationFailure;

const snapshotKeys = new Set([
  "schemaVersion",
  "id",
  "requestId",
  "correlationId",
  "runId",
  "status",
  "observedAt",
  "message",
  "progress",
  "extensions",
]);
const progressKeys = new Set(["current", "total", "percent", "unit"]);
const statusIdPattern = /^sts_[A-Za-z0-9][A-Za-z0-9._~-]{5,127}$/;
const requestIdPattern = /^req_[A-Za-z0-9][A-Za-z0-9._~-]{5,127}$/;
const runIdPattern = /^run_[A-Za-z0-9][A-Za-z0-9._~-]{5,127}$/;
const correlationIdPattern = /^corr_[A-Za-z0-9][A-Za-z0-9._~-]{11,127}$/;
const isoDateTimeUtcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const extensionKeyPattern = /^x-.+$/;
const runStatuses = new Set<unknown>([
  "accepted",
  "queued",
  "running",
  "cancelling",
  "cancelled",
  "completed",
  "failed",
  "blocked",
  "unknown",
]);

export function createRunStatusSnapshot(
  plan: RunRequestExecutionPlan,
  options: CreateRunStatusSnapshotOptions,
): RunStatusSnapshot {
  if (plan.status === "blocked" && options.status !== "blocked") {
    throw new Error("blocked dry-run plans can only emit blocked status snapshots");
  }

  if (plan.status === "ready" && options.status === "blocked") {
    throw new Error("ready dry-run plans cannot emit blocked status snapshots");
  }

  const base: RunStatusSnapshot = {
    schemaVersion: "eip.run-status.v1",
    id: replaceProtocolIdPrefix(plan.provenance.requestId, "sts"),
    requestId: plan.provenance.requestId,
    correlationId: plan.provenance.correlationId,
    status: options.status,
    observedAt: options.observedAt,
    message: createSnapshotMessage(plan, options.status),
  };

  if (options.status === "queued") {
    return {
      ...base,
      runId: replaceProtocolIdPrefix(plan.provenance.requestId, "run"),
    };
  }

  if (options.status === "running") {
    return {
      ...base,
      runId: replaceProtocolIdPrefix(plan.provenance.requestId, "run"),
      progress: {
        current: 0,
        total: 1,
        percent: 0,
        unit: "dry-run",
      },
    };
  }

  if (options.status === "blocked") {
    return {
      ...base,
      extensions: {
        "x-ensen-loop-blocked-reasons": [...plan.blockedReasons],
      },
    };
  }

  return base;
}

export function createBlockedRunStatusSnapshotFromValidationIssues(
  value: unknown,
  issues: readonly RunRequestValidationIssue[],
  observedAt: string,
): RunStatusSnapshot | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (
    typeof value.id !== "string" ||
    !requestIdPattern.test(value.id) ||
    typeof value.correlationId !== "string" ||
    !correlationIdPattern.test(value.correlationId)
  ) {
    return undefined;
  }

  const blockedReasons = issues.map((issue) => `${issue.path}: ${issue.message}`);
  const message = `Dry-run request blocked: ${blockedReasons.join("; ")}`;

  return {
    schemaVersion: "eip.run-status.v1",
    id: replaceProtocolIdPrefix(value.id, "sts"),
    requestId: value.id,
    correlationId: value.correlationId,
    status: "blocked",
    observedAt,
    message: trimToMaxLength(message, 1000),
    extensions: {
      "x-ensen-loop-blocked-reasons": blockedReasons,
    },
  };
}

export function validateRunStatusSnapshot(value: unknown): RunStatusSnapshotValidationResult {
  const issues = collectRunStatusSnapshotIssues(value);

  if (issues.length > 0) {
    return {
      ok: false,
      issues,
    };
  }

  return {
    ok: true,
    snapshot: value as RunStatusSnapshot,
  };
}

function createSnapshotMessage(
  plan: RunRequestExecutionPlan,
  status: CreateRunStatusSnapshotOptions["status"],
): string {
  if (status === "accepted") {
    return "Dry-run request accepted by the Ensen-loop boundary.";
  }

  if (status === "queued") {
    return "Dry-run lane state queued; no workspace or provider action has started.";
  }

  if (status === "running") {
    return "Dry-run lane state running normalization only; no external provider is invoked.";
  }

  return trimToMaxLength(
    `Dry-run request blocked: ${plan.blockedReasons.join("; ")}`,
    1000,
  );
}

function replaceProtocolIdPrefix(id: string, prefix: "run" | "sts"): string {
  return `${prefix}_${id.slice(id.indexOf("_") + 1)}`;
}

function trimToMaxLength(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength);
}

function collectRunStatusSnapshotIssues(
  value: unknown,
): readonly RunRequestValidationIssue[] {
  if (!isRecord(value)) {
    return [
      {
        path: "$",
        message: "RunStatusSnapshot input must be a JSON object.",
      },
    ];
  }

  const issues: RunRequestValidationIssue[] = [];
  collectUnknownKeyIssues(issues, value, snapshotKeys, "$");
  collectConstIssue(issues, "schemaVersion", value.schemaVersion, "eip.run-status.v1");
  collectPatternIssue(issues, "id", value.id, statusIdPattern, "id must be a valid EIP status id.");
  collectPatternIssue(
    issues,
    "requestId",
    value.requestId,
    requestIdPattern,
    "requestId must be a valid EIP request id.",
  );
  collectPatternIssue(
    issues,
    "correlationId",
    value.correlationId,
    correlationIdPattern,
    "correlationId must be a valid EIP correlation id.",
  );
  collectPatternIssue(
    issues,
    "runId",
    value.runId,
    runIdPattern,
    "runId must be a valid EIP run id.",
    true,
  );
  collectEnumIssue(
    issues,
    "status",
    value.status,
    runStatuses,
    "status must be a valid EIP run status.",
  );
  collectUtcTimestampIssue(issues, "observedAt", value.observedAt);
  collectOptionalStringLengthIssue(issues, "message", value.message, 1, 1000);
  collectProgressIssues(issues, value.progress);
  collectExtensionsIssues(issues, value.extensions);

  return issues;
}

function collectProgressIssues(
  issues: RunRequestValidationIssue[],
  value: unknown,
): void {
  if (value === undefined) {
    return;
  }

  if (!isRecord(value)) {
    issues.push({
      path: "progress",
      message: "progress must be a JSON object.",
    });
    return;
  }

  collectUnknownKeyIssues(issues, value, progressKeys, "progress");

  if (Object.keys(value).length === 0) {
    issues.push({
      path: "progress",
      message: "progress must contain at least one field.",
    });
  }

  collectOptionalIntegerMinimumIssue(issues, "progress.current", value.current, 0);
  collectOptionalIntegerMinimumIssue(issues, "progress.total", value.total, 1);
  collectOptionalNumberRangeIssue(issues, "progress.percent", value.percent, 0, 100);
  collectOptionalStringLengthIssue(issues, "progress.unit", value.unit, 1, 80);
}

function collectExtensionsIssues(
  issues: RunRequestValidationIssue[],
  value: unknown,
): void {
  if (value === undefined) {
    return;
  }

  if (!isRecord(value)) {
    issues.push({
      path: "extensions",
      message: "extensions must be a JSON object.",
    });
    return;
  }

  for (const key of Object.keys(value)) {
    if (!extensionKeyPattern.test(key)) {
      issues.push({
        path: `extensions.${key}`,
        message: "extension keys must start with x-.",
      });
    }
  }
}

function collectUnknownKeyIssues(
  issues: RunRequestValidationIssue[],
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push({
        path: path === "$" ? key : `${path}.${key}`,
        message: "field is not allowed.",
      });
    }
  }
}

function collectConstIssue(
  issues: RunRequestValidationIssue[],
  path: string,
  value: unknown,
  expected: string,
): void {
  if (value !== expected) {
    issues.push({
      path,
      message: `${path} must be ${expected}.`,
    });
  }
}

function collectPatternIssue(
  issues: RunRequestValidationIssue[],
  path: string,
  value: unknown,
  pattern: RegExp,
  message: string,
  optional = false,
): void {
  if (value === undefined && optional) {
    return;
  }

  if (typeof value !== "string" || !pattern.test(value)) {
    issues.push({
      path,
      message,
    });
  }
}

function collectEnumIssue(
  issues: RunRequestValidationIssue[],
  path: string,
  value: unknown,
  allowed: ReadonlySet<unknown>,
  message: string,
): void {
  if (!allowed.has(value)) {
    issues.push({
      path,
      message,
    });
  }
}

function collectUtcTimestampIssue(
  issues: RunRequestValidationIssue[],
  path: string,
  value: unknown,
): void {
  if (typeof value !== "string" || !isoDateTimeUtcPattern.test(value)) {
    issues.push({
      path,
      message: `${path} must be a UTC ISO 8601 timestamp.`,
    });
    return;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalizeUtcTimestamp(value)) {
    issues.push({
      path,
      message: `${path} must be a real UTC timestamp.`,
    });
  }
}

function collectOptionalStringLengthIssue(
  issues: RunRequestValidationIssue[],
  path: string,
  value: unknown,
  minLength: number,
  maxLength: number,
): void {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "string" || value.length < minLength || value.length > maxLength) {
    issues.push({
      path,
      message: `${path} must be a string with length ${minLength}-${maxLength}.`,
    });
  }
}

function collectOptionalIntegerMinimumIssue(
  issues: RunRequestValidationIssue[],
  path: string,
  value: unknown,
  minimum: number,
): void {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    issues.push({
      path,
      message: `${path} must be an integer greater than or equal to ${minimum}.`,
    });
  }
}

function collectOptionalNumberRangeIssue(
  issues: RunRequestValidationIssue[],
  path: string,
  value: unknown,
  minimum: number,
  maximum: number,
): void {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "number" || Number.isNaN(value) || value < minimum || value > maximum) {
    issues.push({
      path,
      message: `${path} must be a number between ${minimum} and ${maximum}.`,
    });
  }
}

function normalizeUtcTimestamp(value: string): string {
  const [whole, fractional = ""] = value.slice(0, -1).split(".");
  const normalizedFraction = fractional.replace(/0+$/, "");

  if (normalizedFraction.length === 0) {
    return `${whole}.000Z`;
  }

  return `${whole}.${normalizedFraction.padEnd(3, "0")}Z`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
