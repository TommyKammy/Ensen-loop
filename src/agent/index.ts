export {
  AGENT_PROVIDER_CAPABILITIES,
  type AgentProvider,
  type AgentProviderCapability,
} from "../core/index.js";

export type CodexProviderOperation =
  | "submit"
  | "status"
  | "cancel"
  | "fetchEvidence"
  | "polling"
  | "evidenceReferences"
  | "idempotency";

export type CodexProviderSupportLevel = "supported" | "partial" | "unsupported";

export interface CodexAgentProviderCapabilityEvidence {
  readonly protocolVersion: "0.2.0";
  readonly operations: Readonly<Record<CodexProviderOperation, CodexProviderSupportLevel>>;
}

export type CodexAgentInvocationMode = "dry-run" | "execute";

export interface CodexAgentWorkspaceFact {
  readonly kind: "repo-relative";
  readonly path: string;
}

export interface CodexAgentScopeBinding {
  readonly owner: string;
  readonly repository: string;
  readonly issueNumber: number;
}

export interface CodexAgentIdempotencyBinding {
  readonly key: string;
  readonly scopeFingerprint: string;
}

export interface CodexAgentDryRunProof {
  readonly mode: "dry-run";
  readonly outcome: "planned";
  readonly requestId: string;
  readonly correlationId: string;
  readonly completedAt: string;
  readonly scope: CodexAgentScopeBinding;
  readonly idempotencyBinding: CodexAgentIdempotencyBinding;
}

export interface CodexAgentOperatorApprovalPoint {
  readonly actorType: "human";
  readonly decision: "execute-after-dry-run";
  readonly approvedAt: string;
}

export interface CreateCodexAgentInvocationIntentInput {
  readonly mode?: CodexAgentInvocationMode;
  readonly capabilityEvidence: CodexAgentProviderCapabilityEvidence;
  readonly workspace?: CodexAgentWorkspaceFact;
  readonly allowedExecutionPosture?: "dry-run-only" | "execute-enabled";
  readonly scope?: CodexAgentScopeBinding;
  readonly idempotencyBinding?: CodexAgentIdempotencyBinding;
  readonly dryRunProof?: CodexAgentDryRunProof;
  readonly operatorApproval?: CodexAgentOperatorApprovalPoint;
}

export interface CodexAgentInvocationIntent {
  readonly ok: boolean;
  readonly provider: "codex";
  readonly mode: CodexAgentInvocationMode;
  readonly capabilityEvidence: CodexAgentProviderCapabilityEvidence;
  readonly invocation: {
    readonly intent: "describe-codex-invocation" | "execute-codex-invocation";
    readonly startsProviderSession: false;
    readonly operation: "submit";
  };
  readonly outcome: "planned" | "ready-to-invoke" | "blocked";
  readonly executionPreconditions: {
    readonly dryRunRequired: true;
    readonly dryRunProof: "provided" | "missing";
    readonly operatorApproval: "provided" | "missing";
    readonly mergeSupported: false;
    readonly mergeAuthority: "human-only";
  };
  readonly diagnostics: readonly string[];
}

export interface CodexProviderOperationAvailable {
  readonly ok: true;
}

export interface CodexProviderOperationUnavailable {
  readonly ok: false;
  readonly diagnostic: string;
}

export type CodexProviderOperationAvailability =
  | CodexProviderOperationAvailable
  | CodexProviderOperationUnavailable;

const repoRelativeWorkspacePattern = /^(?:\.|[A-Za-z0-9._-][A-Za-z0-9._/-]*)$/;
const idempotencyKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{11,159}$/;

export const CODEX_AGENT_PROVIDER_CAPABILITY_EVIDENCE: CodexAgentProviderCapabilityEvidence =
  Object.freeze({
    protocolVersion: "0.2.0",
    operations: Object.freeze({
      submit: "supported",
      status: "partial",
      cancel: "unsupported",
      fetchEvidence: "partial",
      polling: "partial",
      evidenceReferences: "supported",
      idempotency: "supported",
    } as const),
  });

export function createCodexAgentInvocationIntent(
  input: CreateCodexAgentInvocationIntentInput,
): CodexAgentInvocationIntent {
  const mode = input.mode ?? "dry-run";
  const diagnostics = validateCommonBoundary(input);

  if (mode === "execute") {
    diagnostics.push(...validateExecuteBoundary(input));
  }

  const ok = diagnostics.length === 0;

  return {
    ok,
    provider: "codex",
    mode,
    capabilityEvidence: input.capabilityEvidence,
    invocation: {
      intent: mode === "execute" ? "execute-codex-invocation" : "describe-codex-invocation",
      startsProviderSession: false,
      operation: "submit",
    },
    outcome: ok ? (mode === "execute" ? "ready-to-invoke" : "planned") : "blocked",
    executionPreconditions: {
      dryRunRequired: true,
      dryRunProof: isSafeDryRunProof(input.dryRunProof) ? "provided" : "missing",
      operatorApproval: isSafeOperatorApproval(input.operatorApproval) ? "provided" : "missing",
      mergeSupported: false,
      mergeAuthority: "human-only",
    },
    diagnostics,
  };
}

export function requireCodexProviderOperation(
  evidence: CodexAgentProviderCapabilityEvidence,
  operation: CodexProviderOperation,
): CodexProviderOperationAvailability {
  const supportLevel = evidence.operations[operation];

  if (supportLevel === "supported") {
    return { ok: true };
  }

  return {
    ok: false,
    diagnostic: `Codex provider operation ${operation} is ${supportLevel}, not supported.`,
  };
}

function validateCommonBoundary(input: CreateCodexAgentInvocationIntentInput): string[] {
  const diagnostics: string[] = [];

  if (input.capabilityEvidence.protocolVersion !== "0.2.0") {
    diagnostics.push("Codex adapter capability evidence must target protocol v0.2.0.");
  }

  for (const operation of requiredOperations) {
    const supportLevel = input.capabilityEvidence.operations[operation];

    if (!isSupportLevel(supportLevel)) {
      diagnostics.push(`Codex provider operation ${operation} is missing capability evidence.`);
    }
  }

  if (input.workspace === undefined) {
    diagnostics.push("Codex adapter workspace is required.");
  } else if (
    input.workspace.kind !== "repo-relative" ||
    !repoRelativeWorkspacePattern.test(input.workspace.path) ||
    input.workspace.path.split("/").some((segment) => segment === "..")
  ) {
    diagnostics.push("Codex adapter workspace must be a repo-relative path without traversal.");
  }

  return diagnostics;
}

function validateExecuteBoundary(input: CreateCodexAgentInvocationIntentInput): string[] {
  const diagnostics: string[] = [];

  if (input.allowedExecutionPosture !== "execute-enabled") {
    diagnostics.push("Codex execute posture is not enabled by explicit local configuration.");
  }

  if (!isSafeScope(input.scope)) {
    diagnostics.push("Codex execute intent requires owner-controlled scope binding.");
  }

  if (!isSafeIdempotencyBinding(input.idempotencyBinding)) {
    diagnostics.push("Codex execute intent requires idempotency binding.");
  }

  if (!isSafeDryRunProof(input.dryRunProof)) {
    diagnostics.push("Codex dogfood execute intent requires prior dry-run proof.");
  } else {
    if (!isSameScopeBinding(input.dryRunProof.scope, input.scope)) {
      diagnostics.push("Codex dogfood execute dry-run proof scope does not match execute scope.");
    }

    if (!isSameIdempotencyBinding(input.dryRunProof.idempotencyBinding, input.idempotencyBinding)) {
      diagnostics.push(
        "Codex dogfood execute dry-run proof idempotency binding does not match execute idempotency binding.",
      );
    }
  }

  if (!isSafeOperatorApproval(input.operatorApproval)) {
    diagnostics.push("Codex dogfood execute intent requires explicit human operator approval after dry run.");
  }

  const submitAvailability = requireCodexProviderOperation(input.capabilityEvidence, "submit");

  if (!submitAvailability.ok) {
    diagnostics.push(submitAvailability.diagnostic);
  }

  const idempotencyAvailability = requireCodexProviderOperation(input.capabilityEvidence, "idempotency");

  if (!idempotencyAvailability.ok) {
    diagnostics.push(idempotencyAvailability.diagnostic);
  }

  return diagnostics;
}

function isSafeScope(scope: CodexAgentScopeBinding | undefined): scope is CodexAgentScopeBinding {
  return (
    scope !== undefined &&
    /^[A-Za-z0-9_.-]{1,100}$/.test(scope.owner) &&
    /^[A-Za-z0-9_.-]{1,100}$/.test(scope.repository) &&
    Number.isSafeInteger(scope.issueNumber) &&
    scope.issueNumber > 0
  );
}

function isSafeIdempotencyBinding(
  binding: CodexAgentIdempotencyBinding | undefined,
): binding is CodexAgentIdempotencyBinding {
  return (
    binding !== undefined &&
    idempotencyKeyPattern.test(binding.key) &&
    /^[A-Za-z0-9._:-]{12,160}$/.test(binding.scopeFingerprint)
  );
}

function isSafeDryRunProof(proof: CodexAgentDryRunProof | undefined): proof is CodexAgentDryRunProof {
  return (
    proof !== undefined &&
    proof.mode === "dry-run" &&
    proof.outcome === "planned" &&
    /^req_[A-Za-z0-9._:-]{12,160}$/.test(proof.requestId) &&
    /^corr_[A-Za-z0-9._:-]{12,160}$/.test(proof.correlationId) &&
    isMillisecondIsoTimestamp(proof.completedAt) &&
    isSafeScope(proof.scope) &&
    isSafeIdempotencyBinding(proof.idempotencyBinding)
  );
}

function isSameScopeBinding(
  left: CodexAgentScopeBinding,
  right: CodexAgentScopeBinding | undefined,
): boolean {
  return (
    right !== undefined &&
    left.owner === right.owner &&
    left.repository === right.repository &&
    left.issueNumber === right.issueNumber
  );
}

function isSameIdempotencyBinding(
  left: CodexAgentIdempotencyBinding,
  right: CodexAgentIdempotencyBinding | undefined,
): boolean {
  return right !== undefined && left.key === right.key && left.scopeFingerprint === right.scopeFingerprint;
}

function isSafeOperatorApproval(
  approval: CodexAgentOperatorApprovalPoint | undefined,
): approval is CodexAgentOperatorApprovalPoint {
  return (
    approval !== undefined &&
    approval.actorType === "human" &&
    approval.decision === "execute-after-dry-run" &&
    isMillisecondIsoTimestamp(approval.approvedAt)
  );
}

function isMillisecondIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isSupportLevel(value: unknown): value is CodexProviderSupportLevel {
  return value === "supported" || value === "partial" || value === "unsupported";
}

const requiredOperations = Object.freeze([
  "submit",
  "status",
  "cancel",
  "fetchEvidence",
  "polling",
  "evidenceReferences",
  "idempotency",
] as const satisfies readonly CodexProviderOperation[]);
