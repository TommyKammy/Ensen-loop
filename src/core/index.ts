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

export const SCM_PROVIDER_CAPABILITIES = [
  "work-item-pickup",
  "lane-branch-intent",
  "lane-worktree-intent",
  "change-request-intent",
  "status-reporting",
] as const;

export type ScmProviderCapability = (typeof SCM_PROVIDER_CAPABILITIES)[number];

export const AGENT_PROVIDER_CAPABILITIES = [
  "dry-run-intent",
  "execute-intent",
] as const;

export type AgentProviderCapability = (typeof AGENT_PROVIDER_CAPABILITIES)[number];

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
  readonly capabilities: readonly AgentProviderCapability[];
}

export interface ScmProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: readonly ScmProviderCapability[];
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

export interface EvidenceBundle {
  readonly workItemId: WorkItem["id"];
  readonly reviewEvents: readonly ReviewEvent[];
  readonly verification: readonly VerificationResult[];
  readonly notes: readonly string[];
}
