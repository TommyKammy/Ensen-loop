export const CORE_MODEL_TERMS = [
  "Work Item",
  "Change Request",
  "Agent Provider",
  "SCM Provider",
  "Verification Result",
  "Review Event",
  "Lane Journal",
  "Durable State",
  "Evidence Bundle",
  "Lane Run",
] as const;

export type CoreModelTerm = (typeof CORE_MODEL_TERMS)[number];

export const MODULE_BOUNDARIES = [
  "src/core",
  "src/lane",
  "src/work-item",
  "src/scm",
  "src/agent",
  "src/verification",
  "src/review",
  "src/audit",
  "src/evidence",
] as const;

export type ModuleBoundary = (typeof MODULE_BOUNDARIES)[number];

export interface WorkItem {
  readonly id: string;
  readonly title: string;
  readonly source: string;
  readonly status: "ready" | "blocked" | "running" | "completed" | "failed";
}

export interface ChangeRequest {
  readonly id: string;
  readonly workItemId: WorkItem["id"];
  readonly status: "draft" | "open" | "merged" | "closed";
}

export interface AgentProvider {
  readonly id: string;
  readonly displayName: string;
}

export interface ScmProvider {
  readonly id: string;
  readonly displayName: string;
}

export interface VerificationResult {
  readonly command: string;
  readonly outcome: "passed" | "failed" | "skipped";
  readonly summary: string;
}

export interface ReviewEvent {
  readonly id: string;
  readonly changeRequestId: ChangeRequest["id"];
  readonly kind: "comment" | "approval" | "change-request" | "dismissal";
}

export interface LaneJournal {
  readonly workItemId: WorkItem["id"];
  readonly entries: readonly string[];
}

export interface DurableState {
  readonly laneRunId: string;
  readonly revision: number;
  readonly updatedAt: string;
}

export interface EvidenceBundle {
  readonly workItemId: WorkItem["id"];
  readonly reviewEvents: readonly ReviewEvent[];
  readonly verification: readonly VerificationResult[];
  readonly notes: readonly string[];
}

export interface LaneRun {
  readonly id: string;
  readonly workItemId: WorkItem["id"];
  readonly state: "queued" | "running" | "verifying" | "reviewing" | "completed" | "failed";
}
