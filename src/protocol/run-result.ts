import type { RunRequestExecutionPlan, RunRequestValidationIssue } from "./run-request.js";

export type RunResultStatus =
  | "succeeded"
  | "failed"
  | "blocked"
  | "needs_review"
  | "cancelled";

export type VerificationStatus = "passed" | "failed" | "blocked" | "not_run";

export interface VerificationCommand {
  readonly command: string;
  readonly status: VerificationStatus;
  readonly completedAt?: string;
  readonly summary?: string;
}

export interface VerificationSummary {
  readonly status: VerificationStatus;
  readonly commands?: readonly VerificationCommand[];
  readonly summary?: string;
}

export interface ChangeRequestRef {
  readonly changeRequestId: string;
  readonly status?: "draft" | "open" | "accepted" | "rejected" | "superseded";
}

export interface EvidenceBundleRef {
  readonly evidenceBundleId: string;
  readonly digest?: string;
}

export interface RunResultErrorInfo {
  readonly code: string;
  readonly message: string;
  readonly retryable?: boolean;
  readonly details?: Record<string, string | number | boolean | null>;
}

export interface RunResultWarningInfo {
  readonly code: string;
  readonly message: string;
}

export interface RunMetrics {
  readonly durationMs?: number;
  readonly attempts?: number;
  readonly tokensInput?: number;
  readonly tokensOutput?: number;
}

export interface RunResult {
  readonly schemaVersion: "eip.run-result.v1";
  readonly id: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly status: RunResultStatus;
  readonly completedAt: string;
  readonly changeRequests?: readonly ChangeRequestRef[];
  readonly evidenceBundles?: readonly EvidenceBundleRef[];
  readonly verification?: VerificationSummary;
  readonly errors?: readonly RunResultErrorInfo[];
  readonly warnings?: readonly RunResultWarningInfo[];
  readonly metrics?: RunMetrics;
  readonly extensions?: Record<string, unknown>;
}

export interface CreateRunResultOptions {
  readonly status: "succeeded" | "failed" | "blocked";
  readonly completedAt: string;
  readonly verification?: VerificationSummary;
  readonly evidenceBundles?: readonly EvidenceBundleRef[];
  readonly errors?: readonly RunResultErrorInfo[];
  readonly warnings?: readonly RunResultWarningInfo[];
  readonly durationMs?: number;
}

export interface RunResultValidationSuccess {
  readonly ok: true;
  readonly result: RunResult;
}

export interface RunResultValidationFailure {
  readonly ok: false;
  readonly issues: readonly RunRequestValidationIssue[];
}

export type RunResultValidationResult =
  | RunResultValidationSuccess
  | RunResultValidationFailure;

const resultKeys = new Set([
  "schemaVersion",
  "id",
  "requestId",
  "correlationId",
  "status",
  "completedAt",
  "changeRequests",
  "evidenceBundles",
  "verification",
  "errors",
  "warnings",
  "metrics",
  "extensions",
]);
const verificationKeys = new Set(["status", "commands", "summary"]);
const verificationCommandKeys = new Set(["command", "status", "completedAt", "summary"]);
const changeRequestKeys = new Set(["changeRequestId", "status"]);
const evidenceBundleKeys = new Set(["evidenceBundleId", "digest"]);
const errorKeys = new Set(["code", "message", "retryable", "details"]);
const warningKeys = new Set(["code", "message"]);
const metricsKeys = new Set([
  "durationMs",
  "attempts",
  "tokensInput",
  "tokensOutput",
]);

const prefixedIdPattern =
  /^(?:actor|artifact|corr|cr|evb|evt|flowstep|policy|pr|repo|req|run|source|sts|workitem)_[A-Za-z0-9][A-Za-z0-9._~-]{5,127}$/;
const requestIdPattern = /^req_[A-Za-z0-9][A-Za-z0-9._~-]{5,127}$/;
const runIdPattern = /^run_[A-Za-z0-9][A-Za-z0-9._~-]{5,127}$/;
const correlationIdPattern = /^corr_[A-Za-z0-9][A-Za-z0-9._~-]{11,127}$/;
const isoDateTimeUtcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const codePattern = /^[A-Z][A-Z0-9_]{2,63}$/;
const extensionKeyPattern = /^x-.+$/;

const terminalRunResultStatuses = new Set<unknown>([
  "succeeded",
  "failed",
  "blocked",
  "needs_review",
  "cancelled",
]);
const verificationStatuses = new Set<unknown>(["passed", "failed", "blocked", "not_run"]);
const changeRequestStatuses = new Set<unknown>([
  "draft",
  "open",
  "accepted",
  "rejected",
  "superseded",
]);

export function createRunResult(
  plan: RunRequestExecutionPlan,
  options: CreateRunResultOptions,
): RunResult {
  if (plan.status === "blocked" && options.status !== "blocked") {
    throw new Error("blocked dry-run plans can only emit blocked run results");
  }

  if (plan.status === "ready" && options.status === "blocked") {
    throw new Error("ready dry-run plans cannot emit blocked run results");
  }

  const result: RunResult = {
    schemaVersion: "eip.run-result.v1",
    id: replaceProtocolIdPrefix(plan.provenance.requestId, "run"),
    requestId: plan.provenance.requestId,
    correlationId: plan.provenance.correlationId,
    status: options.status,
    completedAt: options.completedAt,
    verification: options.verification ?? createDryRunVerification(plan, options.status),
    metrics: {
      attempts: 1,
    },
  };

  return stripUndefinedCollections({
    ...result,
    evidenceBundles:
      options.evidenceBundles !== undefined && options.evidenceBundles.length > 0
        ? options.evidenceBundles.map((evidenceBundle) => ({ ...evidenceBundle }))
        : undefined,
    errors: createErrors(plan, options),
    warnings: createWarnings(plan, options),
    metrics: createMetrics(options),
  });
}

export function createBlockedRunResultFromValidationIssues(
  value: unknown,
  issues: readonly RunRequestValidationIssue[],
  completedAt: string,
): RunResult | undefined {
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

  return {
    schemaVersion: "eip.run-result.v1",
    id: replaceProtocolIdPrefix(value.id, "run"),
    requestId: value.id,
    correlationId: value.correlationId,
    status: "blocked",
    completedAt,
    verification: {
      status: "blocked",
      summary: trimToMaxLength(`Dry-run request blocked: ${blockedReasons.join("; ")}`, 1000),
    },
    warnings: [
      {
        code: "DRY_RUN_BLOCKED",
        message: "The dry-run request stopped before execution because validation failed.",
      },
    ],
    metrics: {
      attempts: 1,
    },
    extensions: {
      "x-ensen-loop-blocked-reasons": blockedReasons,
    },
  };
}

export function validateRunResult(value: unknown): RunResultValidationResult {
  const issues = collectRunResultIssues(value);

  if (issues.length > 0) {
    return {
      ok: false,
      issues,
    };
  }

  return {
    ok: true,
    result: value as RunResult,
  };
}

function createDryRunVerification(
  plan: RunRequestExecutionPlan,
  status: CreateRunResultOptions["status"],
): VerificationSummary {
  if (status === "succeeded") {
    return {
      status: "not_run",
      summary: "Dry-run completed without running verification commands.",
    };
  }

  if (status === "failed") {
    return {
      status: "not_run",
      summary: "Dry-run failed before agent execution or verification commands ran.",
    };
  }

  return {
    status: "blocked",
    summary: trimToMaxLength(
      `Dry-run request blocked: ${plan.blockedReasons.join("; ")}`,
      1000,
    ),
  };
}

function createErrors(
  plan: RunRequestExecutionPlan,
  options: CreateRunResultOptions,
): readonly RunResultErrorInfo[] | undefined {
  if (options.errors !== undefined && options.errors.length > 0) {
    return options.errors.map((error) => ({ ...error }));
  }

  if (options.status !== "failed") {
    return undefined;
  }

  return [
    {
      code: "DRY_RUN_FAILED",
      message: "Dry-run result was marked failed before real agent execution.",
      retryable: false,
      details: {
        requestId: plan.provenance.requestId,
      },
    },
  ];
}

function createWarnings(
  plan: RunRequestExecutionPlan,
  options: CreateRunResultOptions,
): readonly RunResultWarningInfo[] | undefined {
  if (options.warnings !== undefined && options.warnings.length > 0) {
    return options.warnings.map((warning) => ({ ...warning }));
  }

  if (options.status !== "blocked") {
    return undefined;
  }

  return [
    {
      code: "DRY_RUN_BLOCKED",
      message: trimToMaxLength(
        plan.blockedReasons.length === 0
          ? "The dry-run request stopped before execution because planning was blocked."
          : "The dry-run request stopped before execution because required planning scope is missing.",
        1000,
      ),
    },
  ];
}

function createMetrics(options: CreateRunResultOptions): RunMetrics {
  const metrics: RunMetrics = {
    attempts: 1,
  };

  if (options.durationMs !== undefined) {
    return {
      ...metrics,
      durationMs: options.durationMs,
    };
  }

  return metrics;
}

function stripUndefinedCollections(result: RunResult): RunResult {
  return Object.fromEntries(
    Object.entries(result).filter(([, value]) => value !== undefined),
  ) as unknown as RunResult;
}

function replaceProtocolIdPrefix(id: string, prefix: "run"): string {
  return `${prefix}_${id.slice(id.indexOf("_") + 1)}`;
}

function collectRunResultIssues(value: unknown): readonly RunRequestValidationIssue[] {
  if (!isRecord(value)) {
    return [
      {
        path: "$",
        message: "RunResult input must be a JSON object.",
      },
    ];
  }

  const issues: RunRequestValidationIssue[] = [];
  collectUnknownKeyIssues(issues, value, resultKeys, "$");
  collectConstIssue(issues, "schemaVersion", value.schemaVersion, "eip.run-result.v1");
  collectPatternIssue(issues, "id", value.id, runIdPattern, "id must be a valid EIP run id.");
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
  collectEnumIssue(
    issues,
    "status",
    value.status,
    terminalRunResultStatuses,
    "status must be a terminal EIP run result status.",
  );
  collectUtcTimestampIssue(issues, "completedAt", value.completedAt);
  collectChangeRequestIssues(issues, value.changeRequests);
  collectEvidenceBundleIssues(issues, value.evidenceBundles);
  collectVerificationIssues(issues, value.verification);
  collectErrorIssues(issues, value.errors);
  collectWarningIssues(issues, value.warnings);
  collectMetricsIssues(issues, value.metrics);
  collectExtensionsIssues(issues, value.extensions);

  return issues;
}

function collectChangeRequestIssues(
  issues: RunRequestValidationIssue[],
  value: unknown,
): void {
  collectArrayIssues(
    issues,
    "changeRequests",
    value,
    50,
    changeRequestKeys,
    (entry, path) => {
      collectPatternIssue(
        issues,
        `${path}.changeRequestId`,
        entry.changeRequestId,
        prefixedIdPattern,
        "changeRequestId must be a valid EIP id.",
      );
      collectEnumIssue(
        issues,
        `${path}.status`,
        entry.status,
        changeRequestStatuses,
        "status must be a valid change request status.",
        true,
      );
    },
  );
}

function collectEvidenceBundleIssues(
  issues: RunRequestValidationIssue[],
  value: unknown,
): void {
  collectArrayIssues(
    issues,
    "evidenceBundles",
    value,
    50,
    evidenceBundleKeys,
    (entry, path) => {
      collectPatternIssue(
        issues,
        `${path}.evidenceBundleId`,
        entry.evidenceBundleId,
        prefixedIdPattern,
        "evidenceBundleId must be a valid EIP id.",
      );
      collectPatternIssue(
        issues,
        `${path}.digest`,
        entry.digest,
        digestPattern,
        "digest must be a sha256 digest.",
        true,
      );
    },
  );
}

function collectVerificationIssues(
  issues: RunRequestValidationIssue[],
  value: unknown,
): void {
  if (value === undefined) {
    return;
  }

  if (!isRecord(value)) {
    issues.push({
      path: "verification",
      message: "verification must be a JSON object.",
    });
    return;
  }

  collectUnknownKeyIssues(issues, value, verificationKeys, "verification");
  collectEnumIssue(
    issues,
    "verification.status",
    value.status,
    verificationStatuses,
    "verification.status must be a valid verification status.",
  );
  collectOptionalStringLengthIssue(issues, "verification.summary", value.summary, 1, 1000);
  collectArrayIssues(
    issues,
    "verification.commands",
    value.commands,
    50,
    verificationCommandKeys,
    (entry, path) => {
      collectStringLengthIssue(issues, `${path}.command`, entry.command, 1, 240);
      collectEnumIssue(
        issues,
        `${path}.status`,
        entry.status,
        verificationStatuses,
        "status must be a valid verification command status.",
      );
      collectUtcTimestampIssue(issues, `${path}.completedAt`, entry.completedAt, true);
      collectOptionalStringLengthIssue(issues, `${path}.summary`, entry.summary, 1, 500);
    },
  );
}

function collectErrorIssues(issues: RunRequestValidationIssue[], value: unknown): void {
  collectArrayIssues(issues, "errors", value, 50, errorKeys, (entry, path) => {
    collectPatternIssue(issues, `${path}.code`, entry.code, codePattern, "code must be valid.");
    collectStringLengthIssue(issues, `${path}.message`, entry.message, 1, 1000);
    collectOptionalBooleanIssue(issues, `${path}.retryable`, entry.retryable);
    collectDetailsIssues(issues, `${path}.details`, entry.details);
  });
}

function collectWarningIssues(issues: RunRequestValidationIssue[], value: unknown): void {
  collectArrayIssues(issues, "warnings", value, 50, warningKeys, (entry, path) => {
    collectPatternIssue(issues, `${path}.code`, entry.code, codePattern, "code must be valid.");
    collectStringLengthIssue(issues, `${path}.message`, entry.message, 1, 1000);
  });
}

function collectMetricsIssues(issues: RunRequestValidationIssue[], value: unknown): void {
  if (value === undefined) {
    return;
  }

  if (!isRecord(value)) {
    issues.push({
      path: "metrics",
      message: "metrics must be a JSON object.",
    });
    return;
  }

  collectUnknownKeyIssues(issues, value, metricsKeys, "metrics");
  collectOptionalIntegerMinimumIssue(issues, "metrics.durationMs", value.durationMs, 0);
  collectOptionalIntegerMinimumIssue(issues, "metrics.attempts", value.attempts, 1);
  collectOptionalIntegerMinimumIssue(issues, "metrics.tokensInput", value.tokensInput, 0);
  collectOptionalIntegerMinimumIssue(issues, "metrics.tokensOutput", value.tokensOutput, 0);
}

function collectArrayIssues(
  issues: RunRequestValidationIssue[],
  path: string,
  value: unknown,
  maxItems: number,
  allowedKeys: ReadonlySet<string>,
  collectEntryIssues: (entry: Record<string, unknown>, path: string) => void,
): void {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    issues.push({
      path,
      message: `${path} must be an array.`,
    });
    return;
  }

  if (value.length > maxItems) {
    issues.push({
      path,
      message: `${path} must contain at most ${maxItems} items.`,
    });
  }

  value.forEach((entry, index) => {
    const entryPath = `${path}.${index}`;

    if (!isRecord(entry)) {
      issues.push({
        path: entryPath,
        message: `${entryPath} must be a JSON object.`,
      });
      return;
    }

    collectUnknownKeyIssues(issues, entry, allowedKeys, entryPath);
    collectEntryIssues(entry, entryPath);
  });
}

function collectDetailsIssues(
  issues: RunRequestValidationIssue[],
  path: string,
  value: unknown,
): void {
  if (value === undefined) {
    return;
  }

  if (!isRecord(value)) {
    issues.push({
      path,
      message: `${path} must be a JSON object.`,
    });
    return;
  }

  for (const [key, detailValue] of Object.entries(value)) {
    if (
      typeof detailValue !== "string" &&
      typeof detailValue !== "number" &&
      typeof detailValue !== "boolean" &&
      detailValue !== null
    ) {
      issues.push({
        path: `${path}.${key}`,
        message: "details values must be scalar JSON values.",
      });
    }
  }
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
  optional = false,
): void {
  if (value === undefined && optional) {
    return;
  }

  if (!allowed.has(value)) {
    issues.push({
      path,
      message,
    });
  }
}

function collectStringLengthIssue(
  issues: RunRequestValidationIssue[],
  path: string,
  value: unknown,
  minLength: number,
  maxLength: number,
  optional = false,
): void {
  if (value === undefined && optional) {
    return;
  }

  if (typeof value !== "string" || value.length < minLength || value.length > maxLength) {
    issues.push({
      path,
      message: `${path} must be a string with length ${minLength}-${maxLength}.`,
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
  collectStringLengthIssue(issues, path, value, minLength, maxLength, true);
}

function collectUtcTimestampIssue(
  issues: RunRequestValidationIssue[],
  path: string,
  value: unknown,
  optional = false,
): void {
  if (value === undefined && optional) {
    return;
  }

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

function collectOptionalBooleanIssue(
  issues: RunRequestValidationIssue[],
  path: string,
  value: unknown,
): void {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "boolean") {
    issues.push({
      path,
      message: `${path} must be a boolean.`,
    });
  }
}

function trimToMaxLength(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength);
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
