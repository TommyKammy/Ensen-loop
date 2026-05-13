import type {
  CodexAgentInvocationIntent,
  CodexAgentProviderCapabilityEvidence,
  CodexProviderSupportLevel,
} from "../agent/index.js";
import type { WorkItem } from "../core/index.js";
import type { LaneRunState } from "../lane/index.js";
import {
  type EvidenceBundleRef,
  isCustomerLaneEvidenceRef,
  validateCustomerLaneEvidenceRef,
  validateEvidenceBundleRef,
} from "../protocol/index.js";
import {
  containsUnsafePublicArtifactText,
} from "../safety/public-artifact.js";

export type LaneArtifactOutputKind = "patch" | "pr-draft-intent";

export interface LaneArtifactRefInput {
  readonly uri: string;
  readonly mediaType: "text/x-diff" | "application/json" | "text/markdown";
}

export interface LaneArtifactBranchFacts {
  readonly name: string;
  readonly base: string;
}

export interface LaneArtifactWorktreeFacts {
  readonly kind: "repo-relative";
  readonly path: string;
}

export interface LaneArtifactVerificationIntent {
  readonly commands: readonly string[];
}

export interface LaneArtifactOwnerControlledRepository {
  readonly provider: "github";
  readonly repositorySlug: string;
  readonly changeRequestIntentSupported: boolean;
}

export interface CreateLaneArtifactOutputInput {
  readonly kind: LaneArtifactOutputKind;
  readonly laneRunState: LaneRunState;
  readonly workItem: WorkItem;
  readonly branch: LaneArtifactBranchFacts;
  readonly worktree: LaneArtifactWorktreeFacts;
  readonly artifactRef: LaneArtifactRefInput;
  readonly agentOutcome: CodexAgentInvocationIntent;
  readonly verificationIntent: LaneArtifactVerificationIntent;
  readonly capabilityEvidence: CodexAgentProviderCapabilityEvidence;
  readonly evidenceRefs?: readonly EvidenceBundleRef[];
  readonly ownerControlledRepository?: LaneArtifactOwnerControlledRepository;
}

export interface LaneArtifactEvidenceReference {
  readonly evidenceBundleId: string;
  readonly uri: string;
  readonly fetchEvidence: Exclude<CodexProviderSupportLevel, "unsupported">;
}

export interface LaneArtifactOutput {
  readonly schemaVersion: "ensen.loop.lane-artifact-output.v1";
  readonly kind: LaneArtifactOutputKind;
  readonly laneRun: {
    readonly id: string;
    readonly status: "completed";
    readonly revision: number;
  };
  readonly workItem: WorkItem;
  readonly branch: LaneArtifactBranchFacts;
  readonly worktree: LaneArtifactWorktreeFacts;
  readonly artifact: LaneArtifactRefInput;
  readonly agentProvider: {
    readonly provider: CodexAgentInvocationIntent["provider"];
    readonly mode: CodexAgentInvocationIntent["mode"];
    readonly outcome: CodexAgentInvocationIntent["outcome"];
    readonly startsProviderSession: false;
    readonly executionPreconditions: CodexAgentInvocationIntent["executionPreconditions"];
  };
  readonly verificationIntent: LaneArtifactVerificationIntent;
  readonly capabilityEvidence: CodexAgentProviderCapabilityEvidence;
  readonly evidence: {
    readonly embedsEvidencePayload: false;
    readonly fetchEvidence: CodexProviderSupportLevel;
    readonly references: readonly LaneArtifactEvidenceReference[];
  };
  readonly createsPullRequest: false;
  readonly changeRequestIntent: {
    readonly status: "draft" | "not-requested";
    readonly humanReviewBoundary: true;
  };
  readonly humanReview: {
    readonly required: true;
    readonly mergeAuthority: "human-only";
    readonly qualityDecisionAuthority: "human-only";
  };
  readonly mergeReady: false;
  readonly autoMerge: false;
  readonly automaticQualityDecision: false;
}

export interface LaneArtifactOutputValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface LaneArtifactOutputValidationSuccess {
  readonly ok: true;
  readonly artifact: LaneArtifactOutput;
}

export interface LaneArtifactOutputValidationFailure {
  readonly ok: false;
  readonly issues: readonly LaneArtifactOutputValidationIssue[];
}

export type LaneArtifactOutputValidationResult =
  | LaneArtifactOutputValidationSuccess
  | LaneArtifactOutputValidationFailure;

const branchNamePattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/;
const repoRelativePathPattern = /^(?:\.|[A-Za-z0-9._-][A-Za-z0-9._/-]*)$/;
const artifactPathPattern = /^artifacts\/[A-Za-z0-9._~@/-]+$/;
const mediaTypes = new Set<unknown>(["text/x-diff", "application/json", "text/markdown"]);
const repositorySlugPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const unsafePublicArtifactMessage =
  "Lane artifact output must not contain raw secrets, customer identifiers, regulated content, or workstation-local absolute paths.";

export function createLaneArtifactOutput(input: CreateLaneArtifactOutputInput): LaneArtifactOutput {
  const issues = collectCreateLaneArtifactOutputIssues(input);

  if (issues.length > 0) {
    throw new Error(issues[0]?.message ?? "Lane artifact output is malformed.");
  }

  const fetchEvidence = input.capabilityEvidence.operations.fetchEvidence;
  const evidenceRefs = input.evidenceRefs ?? [];
  const artifact: LaneArtifactOutput = {
    schemaVersion: "ensen.loop.lane-artifact-output.v1",
    kind: input.kind,
    laneRun: {
      id: input.laneRunState.id,
      status: "completed",
      revision: input.laneRunState.revision,
    },
    workItem: { ...input.workItem },
    branch: { ...input.branch },
    worktree: { ...input.worktree },
    artifact: { ...input.artifactRef },
    agentProvider: {
      provider: input.agentOutcome.provider,
      mode: input.agentOutcome.mode,
      outcome: input.agentOutcome.outcome,
      startsProviderSession: input.agentOutcome.invocation.startsProviderSession,
      executionPreconditions: input.agentOutcome.executionPreconditions,
    },
    verificationIntent: {
      commands: [...input.verificationIntent.commands],
    },
    capabilityEvidence: input.capabilityEvidence,
    evidence: {
      embedsEvidencePayload: false,
      fetchEvidence,
      references: evidenceRefs.map((evidenceRef) => ({
        evidenceBundleId: evidenceRef.id,
        uri: evidenceRef.uri,
        fetchEvidence: toReferenceFetchEvidence(fetchEvidence),
      })),
    },
    createsPullRequest: false,
    changeRequestIntent: {
      status: input.kind === "pr-draft-intent" ? "draft" : "not-requested",
      humanReviewBoundary: true,
    },
    humanReview: {
      required: true,
      mergeAuthority: "human-only",
      qualityDecisionAuthority: "human-only",
    },
    mergeReady: false,
    autoMerge: false,
    automaticQualityDecision: false,
  };
  const validation = validateLaneArtifactOutput(artifact);

  if (!validation.ok) {
    throw new Error(validation.issues[0]?.message ?? "Lane artifact output is malformed.");
  }

  return artifact;
}

export function validateLaneArtifactOutput(value: unknown): LaneArtifactOutputValidationResult {
  const issues = collectLaneArtifactOutputIssues(value);

  if (issues.length > 0) {
    return {
      ok: false,
      issues,
    };
  }

  return {
    ok: true,
    artifact: value as LaneArtifactOutput,
  };
}

function collectCreateLaneArtifactOutputIssues(
  input: CreateLaneArtifactOutputInput,
): readonly LaneArtifactOutputValidationIssue[] {
  const issues: LaneArtifactOutputValidationIssue[] = [];

  if (input.laneRunState.status !== "completed") {
    issues.push({
      path: "laneRunState.status",
      message: "Artifact output requires a completed lane state.",
    });
  }

  if (
    input.laneRunState.id !== input.laneRunState.journal.laneRunId ||
    input.laneRunState.workItemId !== input.laneRunState.journal.workItemId ||
    input.workItem.id !== input.laneRunState.workItemId
  ) {
    issues.push({
      path: "laneRunState",
      message: "Artifact output requires WorkItem and lane state identifiers to match.",
    });
  }

  collectBranchIssues(issues, input.branch, "branch");
  collectWorktreeIssues(issues, input.worktree, "worktree");
  collectArtifactRefIssues(issues, input.artifactRef, "artifactRef");
  collectVerificationIntentIssues(issues, input.verificationIntent, "verificationIntent");

  if (!input.agentOutcome.ok || input.agentOutcome.invocation.startsProviderSession !== false) {
    issues.push({
      path: "agentOutcome",
      message: "Artifact output requires a successful provider outcome fact that does not start a session.",
    });
  }

  if (input.capabilityEvidence.protocolVersion !== "0.2.0") {
    issues.push({
      path: "capabilityEvidence.protocolVersion",
      message: "Artifact output requires protocol v0.2.0 capability evidence.",
    });
  }

  if (input.capabilityEvidence.operations.evidenceReferences !== "supported") {
    issues.push({
      path: "capabilityEvidence.operations.evidenceReferences",
      message: "Artifact output requires supported evidenceReferences capability.",
    });
  }

  if (input.capabilityEvidence.operations.fetchEvidence === "unsupported" && (input.evidenceRefs?.length ?? 0) > 0) {
    issues.push({
      path: "capabilityEvidence.operations.fetchEvidence",
      message: "Artifact evidence references fail closed when fetchEvidence is unsupported.",
    });
  }

  if (input.kind === "pr-draft-intent") {
    collectPrDraftScopeIssues(issues, input.ownerControlledRepository);
  }

  if (input.kind === "pr-draft-intent" && input.evidenceRefs?.some(isCustomerLaneEvidenceRef) === true) {
    issues.push({
      path: "kind",
      message: "Customer lane artifact output does not support PR draft intent.",
    });
  }

  collectEvidenceRefIssues(issues, input.laneRunState, input.evidenceRefs ?? []);

  return issues;
}

function collectLaneArtifactOutputIssues(value: unknown): readonly LaneArtifactOutputValidationIssue[] {
  const issues: LaneArtifactOutputValidationIssue[] = [];

  if (!isRecord(value)) {
    return [
      {
        path: "$",
        message: "Lane artifact output must be a JSON object.",
      },
    ];
  }

  collectBranchIssues(issues, value.branch, "branch");
  collectWorktreeIssues(issues, value.worktree, "worktree");
  collectArtifactRefIssues(issues, value.artifact, "artifact");
  collectVerificationIntentIssues(issues, value.verificationIntent, "verificationIntent");

  if (value.schemaVersion !== "ensen.loop.lane-artifact-output.v1") {
    issues.push({
      path: "schemaVersion",
      message: "Lane artifact output schemaVersion is unsupported.",
    });
  }

  if (value.kind !== "patch" && value.kind !== "pr-draft-intent") {
    issues.push({
      path: "kind",
      message: "Lane artifact output kind must be patch or pr-draft-intent.",
    });
  }

  if (!isRecord(value.laneRun) || value.laneRun.status !== "completed") {
    issues.push({
      path: "laneRun.status",
      message: "Lane artifact output must be tied to completed lane state.",
    });
  }

  if (
    value.createsPullRequest !== false ||
    value.mergeReady !== false ||
    value.autoMerge !== false ||
    value.automaticQualityDecision !== false
  ) {
    issues.push({
      path: "humanReview",
      message:
        "Lane artifact output must not imply pull request creation, merge readiness, auto merge, or automatic quality decision.",
    });
  }

  collectAgentProviderIssues(issues, value.agentProvider);

  if (
    !isRecord(value.humanReview) ||
    value.humanReview.required !== true ||
    value.humanReview.mergeAuthority !== "human-only" ||
    value.humanReview.qualityDecisionAuthority !== "human-only"
  ) {
    issues.push({
      path: "humanReview",
      message: "Lane artifact output must preserve the human merge and quality review boundary.",
    });
  }

  if (
    !isRecord(value.evidence) ||
    value.evidence.embedsEvidencePayload !== false ||
    !isSupportLevel(value.evidence.fetchEvidence) ||
    !Array.isArray(value.evidence.references)
  ) {
    issues.push({
      path: "evidence",
      message: "Lane artifact output must expose evidence references without embedding evidence payloads.",
    });
  } else {
    for (const [index, reference] of value.evidence.references.entries()) {
      if (
        !isRecord(reference) ||
        typeof reference.evidenceBundleId !== "string" ||
        typeof reference.uri !== "string" ||
        reference.fetchEvidence === "unsupported" ||
        !isSupportLevel(reference.fetchEvidence)
      ) {
        issues.push({
          path: `evidence.references[${index}]`,
          message: "Lane artifact evidence references must identify safe referenced evidence and fetch support.",
        });
      }
    }
  }

  if (containsUnsafePublicText(value)) {
    issues.push({
      path: "$",
      message: unsafePublicArtifactMessage,
    });
  }

  return issues;
}

function collectAgentProviderIssues(
  issues: LaneArtifactOutputValidationIssue[],
  agentProvider: unknown,
): void {
  if (
    !isRecord(agentProvider) ||
    agentProvider.startsProviderSession !== false ||
    (agentProvider.mode !== "dry-run" && agentProvider.mode !== "execute") ||
    (agentProvider.outcome !== "planned" &&
      agentProvider.outcome !== "ready-to-invoke" &&
      agentProvider.outcome !== "blocked") ||
    !isRecord(agentProvider.executionPreconditions) ||
    agentProvider.executionPreconditions.dryRunRequired !== true ||
    (agentProvider.executionPreconditions.dryRunProof !== "provided" &&
      agentProvider.executionPreconditions.dryRunProof !== "missing") ||
    (agentProvider.executionPreconditions.operatorApproval !== "provided" &&
      agentProvider.executionPreconditions.operatorApproval !== "missing") ||
    agentProvider.executionPreconditions.mergeSupported !== false ||
    agentProvider.executionPreconditions.mergeAuthority !== "human-only"
  ) {
    issues.push({
      path: "agentProvider",
      message: "Lane artifact output must preserve dry-run-first and human-only merge preconditions.",
    });
    return;
  }

  if (
    agentProvider.mode === "execute" &&
    (agentProvider.executionPreconditions.dryRunProof !== "provided" ||
      agentProvider.executionPreconditions.operatorApproval !== "provided")
  ) {
    issues.push({
      path: "agentProvider.executionPreconditions",
      message: "Execute-capable artifact metadata requires dry-run proof and human operator approval.",
    });
  }
}

function collectBranchIssues(
  issues: LaneArtifactOutputValidationIssue[],
  branch: unknown,
  pathPrefix: string,
): void {
  if (
    !isRecord(branch) ||
    !isSafeBranchName(branch.name) ||
    !isSafeBranchName(branch.base)
  ) {
    issues.push({
      path: pathPrefix,
      message: "Artifact output requires safe branch facts.",
    });
  }
}

function collectWorktreeIssues(
  issues: LaneArtifactOutputValidationIssue[],
  worktree: unknown,
  pathPrefix: string,
): void {
  if (
    !isRecord(worktree) ||
    worktree.kind !== "repo-relative" ||
    typeof worktree.path !== "string" ||
    !repoRelativePathPattern.test(worktree.path) ||
    worktree.path.split("/").some((segment) => segment === "..")
  ) {
    issues.push({
      path: pathPrefix,
      message: "Artifact output worktree path must be repo-relative and traversal-free.",
    });
  }
}

function collectArtifactRefIssues(
  issues: LaneArtifactOutputValidationIssue[],
  artifactRef: unknown,
  pathPrefix: string,
): void {
  if (!isRecord(artifactRef)) {
    issues.push({
      path: pathPrefix,
      message: "Artifact output requires an artifact reference.",
    });
    return;
  }

  if (
    typeof artifactRef.uri !== "string" ||
    !artifactPathPattern.test(artifactRef.uri) ||
    artifactRef.uri.includes("..") ||
    artifactRef.uri.includes("//") ||
    containsUnsafePublicArtifactText(artifactRef.uri)
  ) {
    issues.push({
      path: `${pathPrefix}.uri`,
      message:
        "Artifact path must be repo-relative under artifacts/ without traversal, secrets, customer identifiers, regulated content, or workstation-local paths.",
    });
  }

  if (!mediaTypes.has(artifactRef.mediaType)) {
    issues.push({
      path: `${pathPrefix}.mediaType`,
      message: "Artifact media type is unsupported.",
    });
  }
}

function collectVerificationIntentIssues(
  issues: LaneArtifactOutputValidationIssue[],
  verificationIntent: unknown,
  pathPrefix: string,
): void {
  if (
    !isRecord(verificationIntent) ||
    !Array.isArray(verificationIntent.commands) ||
    verificationIntent.commands.length === 0 ||
    verificationIntent.commands.some(
      (command) =>
        typeof command !== "string" ||
        command.length === 0 ||
        containsUnsafePublicArtifactText(command),
    )
  ) {
    issues.push({
      path: `${pathPrefix}.commands`,
      message: "Artifact output requires safe verification-intent commands.",
    });
  }
}

function collectPrDraftScopeIssues(
  issues: LaneArtifactOutputValidationIssue[],
  repository: LaneArtifactOwnerControlledRepository | undefined,
): void {
  if (
    repository === undefined ||
    repository.provider !== "github" ||
    !repositorySlugPattern.test(repository.repositorySlug) ||
    repository.changeRequestIntentSupported !== true
  ) {
    issues.push({
      path: "ownerControlledRepository",
      message: "PR draft intent requires an owner-controlled repository with change-request intent support.",
    });
  }
}

function collectEvidenceRefIssues(
  issues: LaneArtifactOutputValidationIssue[],
  laneRunState: LaneRunState,
  evidenceRefs: readonly EvidenceBundleRef[],
): void {
  const stateRefs = new Set(laneRunState.evidence.bundleRefs);

  if (stateRefs.size > 0 && evidenceRefs.length === 0) {
    issues.push({
      path: "evidenceRefs",
      message: "Artifact output requires matching EvidenceBundleRef metadata for lane evidence references.",
    });
    return;
  }

  for (const [index, evidenceRef] of evidenceRefs.entries()) {
    const validation = validateEvidenceBundleRef(evidenceRef);

    if (!validation.ok) {
      issues.push({
        path: `evidenceRefs[${index}]`,
        message: "Artifact output evidence references must be EvidenceBundleRef-compatible.",
      });
      continue;
    }

    if (!stateRefs.has(evidenceRef.uri)) {
      issues.push({
        path: `evidenceRefs[${index}].uri`,
        message: "Artifact output evidence references must match persisted lane state evidence refs.",
      });
    }

    if (containsUnsafePublicText(evidenceRef)) {
      issues.push({
        path: `evidenceRefs[${index}]`,
        message:
          "Artifact output evidence references must not contain raw secrets, customer identifiers, regulated content, or workstation-local paths.",
      });
    }

    const customerLaneValidation = validateCustomerLaneEvidenceRef(validation.ref);
    if (!customerLaneValidation.ok) {
      for (const issue of customerLaneValidation.issues) {
        issues.push({
          path: `evidenceRefs[${index}].${issue.path}`,
          message: issue.message,
        });
      }
    }
  }
}

function isSafeBranchName(branchName: unknown): boolean {
  return (
    typeof branchName === "string" &&
    branchNamePattern.test(branchName) &&
    !branchName.includes("..") &&
    !branchName.includes("//") &&
    !branchName.includes("@{") &&
    !branchName.includes("\\") &&
    !branchName.endsWith("/") &&
    !branchName.endsWith(".") &&
    !branchName.endsWith(".lock") &&
    !branchName.startsWith(".") &&
    !branchName.includes(" ")
  );
}

function containsUnsafePublicText(value: unknown): boolean {
  try {
    const serialized = JSON.stringify(value, (_key, child) => {
      if (typeof child === "string" && containsUnsafePublicArtifactText(child)) {
        return "[UNSAFE]";
      }

      return child;
    });

    return typeof serialized === "string" && serialized.includes("[UNSAFE]");
  } catch {
    return true;
  }
}

function isSupportLevel(value: unknown): value is CodexProviderSupportLevel {
  return value === "supported" || value === "partial" || value === "unsupported";
}

function toReferenceFetchEvidence(
  supportLevel: CodexProviderSupportLevel,
): Exclude<CodexProviderSupportLevel, "unsupported"> {
  if (supportLevel === "unsupported") {
    throw new Error("Artifact evidence references fail closed when fetchEvidence is unsupported.");
  }

  return supportLevel;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
