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

const localWorkItemIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const localWorkItemStatuses = new Set<unknown>([
  "ready",
  "blocked",
  "running",
  "completed",
  "failed",
]);

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

function validateLocalWorkItemTextField(
  path: "title" | "source",
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

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
