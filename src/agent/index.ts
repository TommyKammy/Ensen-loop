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

export interface CreateCodexAgentInvocationIntentInput {
  readonly mode?: CodexAgentInvocationMode;
  readonly capabilityEvidence: CodexAgentProviderCapabilityEvidence;
  readonly workspace?: CodexAgentWorkspaceFact;
  readonly allowedExecutionPosture?: "dry-run-only" | "execute-enabled";
  readonly scope?: CodexAgentScopeBinding;
  readonly idempotencyBinding?: CodexAgentIdempotencyBinding;
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
    input.workspace.path.includes("..")
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
