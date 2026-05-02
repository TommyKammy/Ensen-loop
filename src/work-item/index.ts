import type { WorkItem } from "../core/index.js";

export type { ChangeRequest, WorkItem } from "../core/index.js";

export interface WorkItemValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface WorkItemValidationSuccess {
  readonly ok: true;
  readonly workItem: WorkItem;
}

export interface WorkItemValidationFailure {
  readonly ok: false;
  readonly issues: readonly WorkItemValidationIssue[];
}

export type WorkItemValidationResult = WorkItemValidationSuccess | WorkItemValidationFailure;

export type IssueReadinessStatus = "runnable" | "blocked" | "needs-human-refinement";

export type IssueReadinessDiagnosticCategory =
  | "readiness_info"
  | "validation_failure"
  | "unsupported_capability"
  | "provider_rejection_before_run_binding"
  | "evidence_unavailable"
  | "unknown_failure"
  | "unsupported_eip_major_version"
  | "behavior_delta_violation";

export type IssueReadinessDiagnosticSeverity = "info" | "human" | "blocker";

export interface IssueReadinessDiagnostic {
  readonly category: IssueReadinessDiagnosticCategory;
  readonly path: string;
  readonly message: string;
  readonly severity: IssueReadinessDiagnosticSeverity;
}

export interface IssueReadinessBoundary {
  readonly capability: "work-item-readiness";
  readonly startsExecution: false;
  readonly emitsProtocolTerminalArtifact: false;
  readonly protocolRuntimeImported: false;
  readonly providerNeutral: true;
}

export interface IssueReadinessScope {
  readonly ownerControlled?: boolean;
}

export interface IssueReadinessFacts {
  readonly acceptanceCriteria?: readonly string[];
  readonly behaviorDeltas?: readonly string[];
  readonly scopeItems?: readonly string[];
  readonly requestedCapabilities?: readonly string[];
  readonly eipMajorVersion?: number;
  readonly terminalState?: "open" | "closed" | "unknown";
  readonly bodyText?: string;
  readonly unsafeInputs?: readonly string[];
}

export interface IssueReadinessInput {
  readonly workItem: WorkItem;
  readonly scope?: IssueReadinessScope;
  readonly issue?: IssueReadinessFacts;
  readonly supportedCapabilities?: readonly string[];
  readonly supportedEipMajorVersions?: readonly number[];
}

export interface IssueReadinessResult {
  readonly status: IssueReadinessStatus;
  readonly runnable: boolean;
  readonly workItem: WorkItem;
  readonly diagnostics: readonly IssueReadinessDiagnostic[];
  readonly boundary: IssueReadinessBoundary;
}

const localWorkItemIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const localWorkItemStatuses = new Set<unknown>([
  "ready",
  "blocked",
  "running",
  "completed",
  "failed",
]);
const defaultReadinessCapabilities = Object.freeze(["work-item-readiness"] as const);
const defaultSupportedEipMajorVersions = Object.freeze([1] as const);
const workstationLocalPathPattern =
  /(?:^|[\s([{"'`:=<])(?:\/(?!\/)\S+|[A-Za-z]:[\\/]\S+|\\\\\S+)/;
const secretLikeTextPattern =
  /\b(?:token|secret|password|authorization|api[_-]?key)\b\s*[:=]\s*\S+/i;

const issueReadinessBoundary: IssueReadinessBoundary = Object.freeze({
  capability: "work-item-readiness",
  startsExecution: false,
  emitsProtocolTerminalArtifact: false,
  protocolRuntimeImported: false,
  providerNeutral: true,
});

export class WorkItemValidationError extends Error {
  readonly issues: readonly WorkItemValidationIssue[];

  constructor(issues: readonly WorkItemValidationIssue[]) {
    super(
      `Local work item is malformed: ${issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "WorkItemValidationError";
    this.issues = issues;
  }
}

export const sampleLocalWorkItem: WorkItem = {
  id: "sample-local-work-item",
  title: "Sample local work item",
  source: "local-sample",
  status: "ready",
};

export function validateLocalWorkItem(value: unknown): WorkItemValidationResult {
  const issues = collectLocalWorkItemIssues(value);

  if (issues.length > 0) {
    return {
      ok: false,
      issues,
    };
  }

  return {
    ok: true,
    workItem: value as WorkItem,
  };
}

export function parseLocalWorkItem(value: unknown): WorkItem {
  const result = validateLocalWorkItem(value);

  if (!result.ok) {
    throw new WorkItemValidationError(result.issues);
  }

  return result.workItem;
}

export function evaluateIssueReadiness(input: IssueReadinessInput): IssueReadinessResult {
  const diagnostics: IssueReadinessDiagnostic[] = [];
  const workItemValidationIssues = collectCoreWorkItemReadinessIssues(input.workItem);
  const issue = input.issue ?? {};
  const supportedCapabilities = input.supportedCapabilities ?? defaultReadinessCapabilities;
  const supportedEipMajorVersions =
    input.supportedEipMajorVersions ?? defaultSupportedEipMajorVersions;

  for (const issue of workItemValidationIssues) {
    diagnostics.push({
      category: "validation_failure",
      path: `workItem.${issue.path}`,
      message: issue.message,
      severity: "blocker",
    });
  }

  if (input.workItem.status !== "ready") {
    diagnostics.push({
      category: "unknown_failure",
      path: "workItem.status",
      message: "Issue readiness requires a ready WorkItem lifecycle state.",
      severity: "blocker",
    });
  }

  if (input.scope?.ownerControlled !== true) {
    diagnostics.push({
      category: "provider_rejection_before_run_binding",
      path: "scope.ownerControlled",
      message: "Issue scope must be explicitly owner-controlled before lane execution.",
      severity: "blocker",
    });
  }

  validateAcceptanceCriteria(issue, diagnostics);
  validateBehaviorDeltas(issue, diagnostics);
  validateScopeItems(issue, diagnostics);
  validateCapabilities(issue, supportedCapabilities, diagnostics);
  validateEipMajorVersion(issue, supportedEipMajorVersions, diagnostics);
  validateTerminalState(issue, diagnostics);
  validateUnsafeInputs(issue, diagnostics);

  const hasBlocker = diagnostics.some((diagnostic) => diagnostic.severity === "blocker");
  const hasHumanRefinement = diagnostics.some((diagnostic) => diagnostic.severity === "human");
  const status: IssueReadinessStatus = hasBlocker
    ? "blocked"
    : hasHumanRefinement
      ? "needs-human-refinement"
      : "runnable";

  if (status === "runnable") {
    diagnostics.push({
      category: "readiness_info",
      path: "issue.behaviorDeltas",
      message: "Issue has one observable behavior delta.",
      severity: "info",
    });
  }

  return {
    status,
    runnable: status === "runnable",
    workItem: input.workItem,
    diagnostics,
    boundary: issueReadinessBoundary,
  };
}

function collectCoreWorkItemReadinessIssues(
  workItem: WorkItem,
): readonly WorkItemValidationIssue[] {
  const issues: WorkItemValidationIssue[] = [];

  const idIssue = validateLocalWorkItemTextField("id", workItem.id);
  if (idIssue !== undefined) {
    issues.push(idIssue);
  }

  const titleIssue = validateLocalWorkItemTextField("title", workItem.title);
  if (titleIssue !== undefined) {
    issues.push(titleIssue);
  }

  const sourceIssue = validateLocalWorkItemTextField("source", workItem.source);
  if (sourceIssue !== undefined) {
    issues.push(sourceIssue);
  }

  if (!localWorkItemStatuses.has(workItem.status)) {
    issues.push({
      path: "status",
      message: "status must be one of: ready, blocked, running, completed, failed.",
    });
  }

  return issues;
}

function collectLocalWorkItemIssues(value: unknown): readonly WorkItemValidationIssue[] {
  if (!isRecord(value)) {
    return [
      {
        path: "$",
        message: "Local work item input must be a JSON object.",
      },
    ];
  }

  const issues: WorkItemValidationIssue[] = [];
  const allowedKeys = new Set(["id", "title", "source", "status"]);

  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push({
        path: key,
        message: "field is not part of the Phase 1 local work item contract.",
      });
    }
  }

  if (!isLocalWorkItemId(value.id)) {
    issues.push({
      path: "id",
      message:
        "id is required and must be a non-empty string matching letters, numbers, dots, underscores, or hyphens.",
    });
  }

  const titleTextIssue = validateLocalWorkItemTextField("title", value.title);
  if (titleTextIssue !== undefined) {
    issues.push(titleTextIssue);
  }

  const sourceTextIssue = validateLocalWorkItemTextField("source", value.source);
  if (sourceTextIssue !== undefined) {
    issues.push(sourceTextIssue);
  }

  if (!localWorkItemStatuses.has(value.status)) {
    issues.push({
      path: "status",
      message: "status must be one of: ready, blocked, running, completed, failed.",
    });
  }

  return issues;
}

function validateAcceptanceCriteria(
  issue: IssueReadinessFacts,
  diagnostics: IssueReadinessDiagnostic[],
): void {
  const acceptanceCriteria = issue.acceptanceCriteria ?? [];

  if (acceptanceCriteria.length === 0) {
    diagnostics.push({
      category: "validation_failure",
      path: "issue.acceptanceCriteria",
      message: "Issue needs explicit acceptance criteria before lane execution.",
      severity: "human",
    });
    return;
  }

  if (!allNonBlankStrings(acceptanceCriteria)) {
    diagnostics.push({
      category: "validation_failure",
      path: "issue.acceptanceCriteria",
      message: "Issue acceptance criteria must contain only non-empty public text.",
      severity: "blocker",
    });
  }

  if (acceptanceCriteria.length > 12) {
    diagnostics.push({
      category: "validation_failure",
      path: "issue.acceptanceCriteria",
      message: "Issue acceptance criteria are too broad for one lane run.",
      severity: "blocker",
    });
  }
}

function validateBehaviorDeltas(
  issue: IssueReadinessFacts,
  diagnostics: IssueReadinessDiagnostic[],
): void {
  const behaviorDeltas = issue.behaviorDeltas ?? [];

  if (behaviorDeltas.length === 0) {
    diagnostics.push({
      category: "behavior_delta_violation",
      path: "issue.behaviorDeltas",
      message: "Issue needs exactly one observable behavior delta.",
      severity: "human",
    });
    return;
  }

  if (behaviorDeltas.length !== 1 || !allNonBlankStrings(behaviorDeltas)) {
    diagnostics.push({
      category: "behavior_delta_violation",
      path: "issue.behaviorDeltas",
      message: "Issue must describe exactly one observable behavior delta.",
      severity: "blocker",
    });
  }
}

function validateScopeItems(
  issue: IssueReadinessFacts,
  diagnostics: IssueReadinessDiagnostic[],
): void {
  const scopeItems = issue.scopeItems ?? [];

  if (scopeItems.length === 0) {
    diagnostics.push({
      category: "validation_failure",
      path: "issue.scopeItems",
      message: "Issue needs explicit bounded scope before lane execution.",
      severity: "human",
    });
    return;
  }

  if (!allNonBlankStrings(scopeItems)) {
    diagnostics.push({
      category: "validation_failure",
      path: "issue.scopeItems",
      message: "Issue scope must contain only non-empty public text.",
      severity: "blocker",
    });
  }

  if (scopeItems.length > 8) {
    diagnostics.push({
      category: "validation_failure",
      path: "issue.scopeItems",
      message: "Issue scope is too broad for one lane run.",
      severity: "blocker",
    });
  }
}

function validateCapabilities(
  issue: IssueReadinessFacts,
  supportedCapabilities: readonly string[],
  diagnostics: IssueReadinessDiagnostic[],
): void {
  const requestedCapabilities = issue.requestedCapabilities ?? [];

  requestedCapabilities.forEach((capability, index) => {
    if (typeof capability !== "string" || !supportedCapabilities.includes(capability)) {
      diagnostics.push({
        category: "unsupported_capability",
        path: `issue.requestedCapabilities[${index}]`,
        message: "Issue requests an unsupported pre-execution capability.",
        severity: "blocker",
      });
    }
  });
}

function validateEipMajorVersion(
  issue: IssueReadinessFacts,
  supportedEipMajorVersions: readonly number[],
  diagnostics: IssueReadinessDiagnostic[],
): void {
  if (
    issue.eipMajorVersion !== undefined &&
    (!Number.isSafeInteger(issue.eipMajorVersion) ||
      !supportedEipMajorVersions.includes(issue.eipMajorVersion))
  ) {
    diagnostics.push({
      category: "unsupported_eip_major_version",
      path: "issue.eipMajorVersion",
      message: "Issue references an unsupported EIP major version.",
      severity: "blocker",
    });
  }
}

function validateTerminalState(
  issue: IssueReadinessFacts,
  diagnostics: IssueReadinessDiagnostic[],
): void {
  if (issue.terminalState !== "open") {
    diagnostics.push({
      category: "unknown_failure",
      path: "issue.terminalState",
      message: "Issue terminal state is ambiguous or not open for readiness evaluation.",
      severity: "blocker",
    });
  }
}

function validateUnsafeInputs(
  issue: IssueReadinessFacts,
  diagnostics: IssueReadinessDiagnostic[],
): void {
  issue.unsafeInputs?.forEach((_unsafeInput, index) => {
    diagnostics.push({
      category: "evidence_unavailable",
      path: `issue.unsafeInputs[${index}]`,
      message: "Issue readiness input contains unsafe or secret-like evidence.",
      severity: "blocker",
    });
  });

  const publicTextFields: readonly (readonly [string, string | undefined])[] = [
    ["issue.bodyText", issue.bodyText],
    ...(issue.acceptanceCriteria ?? []).map(
      (value, index) => [`issue.acceptanceCriteria[${index}]`, value] as const,
    ),
    ...(issue.behaviorDeltas ?? []).map(
      (value, index) => [`issue.behaviorDeltas[${index}]`, value] as const,
    ),
    ...(issue.scopeItems ?? []).map(
      (value, index) => [`issue.scopeItems[${index}]`, value] as const,
    ),
  ];

  for (const [path, value] of publicTextFields) {
    if (
      typeof value === "string" &&
      (workstationLocalPathPattern.test(value) || secretLikeTextPattern.test(value))
    ) {
      diagnostics.push({
        category: "evidence_unavailable",
        path,
        message: "Issue readiness input contains unsafe or secret-like evidence.",
        severity: "blocker",
      });
    }
  }
}

function validateLocalWorkItemTextField(
  path: "id" | "title" | "source",
  value: unknown,
): WorkItemValidationIssue | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return {
      path,
      message: `${path} is required and must be a non-empty string.`,
    };
  }

  if (value.trim().length === 0) {
    return {
      path,
      message: `${path} is required and must contain non-whitespace text.`,
    };
  }

  return undefined;
}

function isLocalWorkItemId(value: unknown): value is string {
  return typeof value === "string" && localWorkItemIdPattern.test(value);
}

function allNonBlankStrings(values: readonly unknown[]): boolean {
  return values.every((value) => typeof value === "string" && value.trim().length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
