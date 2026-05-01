import {
  AGENT_PROVIDER_CAPABILITIES,
  SCM_PROVIDER_CAPABILITIES,
} from "../core/index.js";

export interface RunRequestSource {
  readonly sourceId: string;
  readonly sourceType: string;
  readonly externalRef?: string;
}

export interface RunRequestActor {
  readonly actorId: string;
  readonly actorType:
    | "human"
    | "workflow"
    | "system"
    | "api_client"
    | "connector"
    | "executor"
    | "agent";
  readonly displayName?: string;
}

export interface RunRequestWorkItem {
  readonly workItemId: string;
  readonly externalId: string;
  readonly title?: string;
  readonly url?: string;
}

export interface RunRequestTarget {
  readonly targetType: "repository" | "workspace" | "environment" | "manual";
  readonly targetId: string;
  readonly externalRef?: string;
}

export interface RunRequestPolicyContext {
  readonly policySetId?: string;
  readonly riskClasses?: readonly string[];
  readonly requiresApproval?: boolean;
}

export interface RunRequest {
  readonly schemaVersion: "eip.run-request.v1";
  readonly id: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly source: RunRequestSource;
  readonly requestedBy: RunRequestActor;
  readonly workItem: RunRequestWorkItem;
  readonly mode: "plan" | "apply" | "validate";
  readonly createdAt: string;
  readonly target?: RunRequestTarget;
  readonly policyContext?: RunRequestPolicyContext;
  readonly dataClassification?: "public" | "internal" | "confidential" | "restricted";
  readonly extensions?: Record<string, unknown>;
}

export interface RunRequestValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface BoundedRunRequestInputFact {
  readonly name: string;
  readonly value: unknown;
  readonly trustedAuthority: false;
}

export interface RunRequestExecutionPlan {
  readonly command: "run-request";
  readonly mode: RunRequest["mode"];
  readonly source: "eip.run-request";
  readonly status: "ready" | "blocked";
  readonly blockedReasons: readonly string[];
  readonly provenance: {
    readonly requestId: string;
    readonly correlationId: string;
    readonly idempotencyKey: string;
    readonly schemaVersion: RunRequest["schemaVersion"];
    readonly createdAt: string;
    readonly source: RunRequestSource;
  };
  readonly workItem: {
    readonly id: string;
    readonly title: string;
    readonly source: string;
    readonly status: "ready" | "blocked";
  };
  readonly requestIdentity: {
    readonly requestedBy: RunRequestActor;
    readonly workItemExternalId: string;
    readonly workItemUrl?: string;
  };
  readonly boundedInputFacts: readonly BoundedRunRequestInputFact[];
  readonly laneWorkspace: {
    readonly intent: string;
    readonly mutatesFilesystem: false;
    readonly target?: RunRequestTarget;
  };
  readonly agentProvider: {
    readonly intent: string;
    readonly capabilities: typeof AGENT_PROVIDER_CAPABILITIES;
    readonly invokesProvider: false;
  };
  readonly scmProvider: {
    readonly intent: string;
    readonly capabilities: typeof SCM_PROVIDER_CAPABILITIES;
    readonly createsBranch: false;
    readonly opensChangeRequest: false;
  };
  readonly policy: {
    readonly intent: string;
    readonly trustedAuthority: false;
    readonly policySetId?: string;
    readonly riskClasses: readonly string[];
    readonly requiresApproval: boolean;
  };
  readonly verification: {
    readonly intent: string;
    readonly commands: readonly string[];
  };
  readonly evidence: {
    readonly intent: string;
    readonly writesDurableEvidence: false;
    readonly bundleRefs: readonly [];
  };
}

export interface RunRequestValidationSuccess {
  readonly ok: true;
  readonly request: RunRequest;
}

export interface RunRequestValidationFailure {
  readonly ok: false;
  readonly issues: readonly RunRequestValidationIssue[];
}

export type RunRequestValidationResult =
  | RunRequestValidationSuccess
  | RunRequestValidationFailure;

export class RunRequestValidationError extends Error {
  readonly issues: readonly RunRequestValidationIssue[];

  constructor(issues: readonly RunRequestValidationIssue[]) {
    super(
      `RunRequest is malformed: ${issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "RunRequestValidationError";
    this.issues = issues;
  }
}

const topLevelKeys = new Set([
  "schemaVersion",
  "id",
  "correlationId",
  "idempotencyKey",
  "source",
  "requestedBy",
  "workItem",
  "mode",
  "createdAt",
  "target",
  "policyContext",
  "dataClassification",
  "extensions",
]);
const sourceKeys = new Set(["sourceId", "sourceType", "externalRef"]);
const actorKeys = new Set(["actorId", "actorType", "displayName"]);
const workItemKeys = new Set(["workItemId", "externalId", "title", "url"]);
const targetKeys = new Set(["targetType", "targetId", "externalRef"]);
const policyContextKeys = new Set(["policySetId", "riskClasses", "requiresApproval"]);

const requestIdPattern = /^req_[A-Za-z0-9][A-Za-z0-9._~-]{5,127}$/;
const sourceIdPattern = /^source_[A-Za-z0-9][A-Za-z0-9._~-]{5,127}$/;
const actorIdPattern = /^actor_[A-Za-z0-9][A-Za-z0-9._~-]{5,127}$/;
const workItemIdPattern = /^workitem_[A-Za-z0-9][A-Za-z0-9._~-]{5,127}$/;
const repositoryIdPattern = /^repo_[A-Za-z0-9][A-Za-z0-9._~-]{5,127}$/;
const policyIdPattern = /^policy_[A-Za-z0-9][A-Za-z0-9._~-]{5,127}$/;
const prefixedIdPattern =
  /^(?:actor|artifact|corr|cr|evb|evt|flowstep|policy|pr|repo|req|run|source|sts|workitem)_[A-Za-z0-9][A-Za-z0-9._~-]{5,127}$/;
const correlationIdPattern = /^corr_[A-Za-z0-9][A-Za-z0-9._~-]{11,127}$/;
const idempotencyKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{11,159}$/;
const isoDateTimeUtcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const sourceTypePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const riskClassPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const extensionKeyPattern = /^x-.+$/;

const modes = new Set<unknown>(["plan", "apply", "validate"]);
const actorTypes = new Set<unknown>([
  "human",
  "workflow",
  "system",
  "api_client",
  "connector",
  "executor",
  "agent",
]);
const targetTypes = new Set<unknown>([
  "repository",
  "workspace",
  "environment",
  "manual",
]);
const dataClassifications = new Set<unknown>([
  "public",
  "internal",
  "confidential",
  "restricted",
]);

export function validateRunRequest(value: unknown): RunRequestValidationResult {
  const issues = collectRunRequestIssues(value);

  if (issues.length > 0) {
    return {
      ok: false,
      issues,
    };
  }

  return {
    ok: true,
    request: value as RunRequest,
  };
}

export function parseRunRequest(value: unknown): RunRequest {
  const result = validateRunRequest(value);

  if (!result.ok) {
    throw new RunRequestValidationError(result.issues);
  }

  return result.request;
}

export function createRunRequestExecutionPlan(request: RunRequest): RunRequestExecutionPlan {
  const blockedReasons = collectRunRequestPlanBlockedReasons(request);
  const status = blockedReasons.length === 0 ? "ready" : "blocked";

  return {
    command: "run-request",
    mode: request.mode,
    source: "eip.run-request",
    status,
    blockedReasons,
    provenance: {
      requestId: request.id,
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
      schemaVersion: request.schemaVersion,
      createdAt: request.createdAt,
      source: { ...request.source },
    },
    workItem: {
      id: request.workItem.workItemId,
      title: request.workItem.title ?? request.workItem.externalId,
      source: `eip.run-request:${request.source.sourceType}`,
      status,
    },
    requestIdentity: createRunRequestIdentity(request),
    boundedInputFacts: collectBoundedInputFacts(request),
    laneWorkspace: createLaneWorkspacePlan(request),
    agentProvider: {
      intent: "normalize agent intent without invoking a provider",
      capabilities: AGENT_PROVIDER_CAPABILITIES,
      invokesProvider: false,
    },
    scmProvider: {
      intent: "normalize repository intent without creating branches, commits, or change requests",
      capabilities: SCM_PROVIDER_CAPABILITIES,
      createsBranch: false,
      opensChangeRequest: false,
    },
    policy: createPolicyPlan(request),
    verification: {
      intent: "normalize verification intent without running checks",
      commands: [],
    },
    evidence: {
      intent: "normalize evidence intent without writing durable evidence",
      writesDurableEvidence: false,
      bundleRefs: [],
    },
  };
}

function collectRunRequestPlanBlockedReasons(request: RunRequest): readonly string[] {
  const reasons: string[] = [];

  if (request.target === undefined) {
    reasons.push("target is required before execution can be planned");
  }

  if (request.policyContext === undefined) {
    reasons.push("policyContext is required before execution can be planned");
  }

  return reasons;
}

function createRunRequestIdentity(
  request: RunRequest,
): RunRequestExecutionPlan["requestIdentity"] {
  const identity: RunRequestExecutionPlan["requestIdentity"] = {
    requestedBy: { ...request.requestedBy },
    workItemExternalId: request.workItem.externalId,
  };

  if (request.workItem.url !== undefined) {
    return {
      ...identity,
      workItemUrl: request.workItem.url,
    };
  }

  return identity;
}

function collectBoundedInputFacts(
  request: RunRequest,
): readonly BoundedRunRequestInputFact[] {
  const facts: BoundedRunRequestInputFact[] = [];

  pushOptionalFact(facts, "source.externalRef", request.source.externalRef);
  pushOptionalFact(facts, "workItem.externalId", request.workItem.externalId);
  pushOptionalFact(facts, "workItem.url", request.workItem.url);
  pushOptionalFact(facts, "target.externalRef", request.target?.externalRef);

  for (const [key, value] of Object.entries(request.extensions ?? {}).sort(([left], [right]) =>
    compareCodePoints(left, right),
  )) {
    pushOptionalFact(facts, `extensions.${key}`, value);
  }

  return facts;
}

function pushOptionalFact(
  facts: BoundedRunRequestInputFact[],
  name: string,
  value: unknown,
): void {
  if (value === undefined) {
    return;
  }

  facts.push({
    name,
    value,
    trustedAuthority: false,
  });
}

function createLaneWorkspacePlan(
  request: RunRequest,
): RunRequestExecutionPlan["laneWorkspace"] {
  const plan: RunRequestExecutionPlan["laneWorkspace"] = {
    intent: "normalize request scope without preparing a workspace",
    mutatesFilesystem: false,
  };

  if (request.target !== undefined) {
    return {
      ...plan,
      target: { ...request.target },
    };
  }

  return plan;
}

function createPolicyPlan(request: RunRequest): RunRequestExecutionPlan["policy"] {
  return {
    intent: "record policy hints without granting execution authority",
    trustedAuthority: false,
    policySetId: request.policyContext?.policySetId,
    riskClasses: [...(request.policyContext?.riskClasses ?? [])],
    requiresApproval: request.policyContext?.requiresApproval ?? false,
  };
}

function compareCodePoints(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function collectRunRequestIssues(value: unknown): readonly RunRequestValidationIssue[] {
  if (!isRecord(value)) {
    return [
      {
        path: "$",
        message: "RunRequest input must be a JSON object.",
      },
    ];
  }

  const issues: RunRequestValidationIssue[] = [];
  collectUnknownKeyIssues(issues, value, topLevelKeys, "$");

  collectConstIssue(issues, "schemaVersion", value.schemaVersion, "eip.run-request.v1");
  collectPatternIssue(issues, "id", value.id, requestIdPattern, "id must be a valid EIP request id.");
  collectPatternIssue(
    issues,
    "correlationId",
    value.correlationId,
    correlationIdPattern,
    "correlationId must be a valid EIP correlation id.",
  );
  collectStringLengthPatternIssue(
    issues,
    "idempotencyKey",
    value.idempotencyKey,
    12,
    160,
    idempotencyKeyPattern,
    "idempotencyKey must be 12-160 characters and match the EIP idempotency key pattern.",
  );
  collectSourceIssues(issues, value.source);
  collectActorIssues(issues, value.requestedBy);
  collectWorkItemIssues(issues, value.workItem);
  collectEnumIssue(issues, "mode", value.mode, modes, "mode must be one of: plan, apply, validate.");
  collectUtcTimestampIssue(issues, "createdAt", value.createdAt);
  collectTargetIssues(issues, value.target);
  collectPolicyContextIssues(issues, value.policyContext);
  collectEnumIssue(
    issues,
    "dataClassification",
    value.dataClassification,
    dataClassifications,
    "dataClassification must be one of: public, internal, confidential, restricted.",
    true,
  );
  collectExtensionsIssues(issues, value.extensions);

  return issues;
}

function collectSourceIssues(
  issues: RunRequestValidationIssue[],
  value: unknown,
): void {
  if (!isRecord(value)) {
    issues.push({
      path: "source",
      message: "source must be a JSON object.",
    });
    return;
  }

  collectUnknownKeyIssues(issues, value, sourceKeys, "source");
  collectPatternIssue(
    issues,
    "source.sourceId",
    value.sourceId,
    sourceIdPattern,
    "sourceId must be a valid EIP source id.",
  );
  collectStringLengthPatternIssue(
    issues,
    "source.sourceType",
    value.sourceType,
    1,
    80,
    sourceTypePattern,
    "sourceType must be 1-80 lowercase kebab-case characters.",
  );
  collectOptionalStringLengthIssue(issues, "source.externalRef", value.externalRef, 1, 240);
}

function collectActorIssues(
  issues: RunRequestValidationIssue[],
  value: unknown,
): void {
  if (!isRecord(value)) {
    issues.push({
      path: "requestedBy",
      message: "requestedBy must be a JSON object.",
    });
    return;
  }

  collectUnknownKeyIssues(issues, value, actorKeys, "requestedBy");
  collectPatternIssue(
    issues,
    "requestedBy.actorId",
    value.actorId,
    actorIdPattern,
    "actorId must be a valid EIP actor id.",
  );
  collectEnumIssue(
    issues,
    "requestedBy.actorType",
    value.actorType,
    actorTypes,
    "actorType must be one of: human, workflow, system, api_client, connector, executor, agent.",
  );
  collectOptionalStringLengthIssue(issues, "requestedBy.displayName", value.displayName, 1, 160);
}

function collectWorkItemIssues(
  issues: RunRequestValidationIssue[],
  value: unknown,
): void {
  if (!isRecord(value)) {
    issues.push({
      path: "workItem",
      message: "workItem must be a JSON object.",
    });
    return;
  }

  collectUnknownKeyIssues(issues, value, workItemKeys, "workItem");
  collectPatternIssue(
    issues,
    "workItem.workItemId",
    value.workItemId,
    workItemIdPattern,
    "workItemId must be a valid EIP work item id.",
  );
  collectStringLengthIssue(issues, "workItem.externalId", value.externalId, 1, 240);
  collectOptionalStringLengthIssue(issues, "workItem.title", value.title, 1, 240);

  if (value.url !== undefined) {
    collectHttpsUrlIssue(issues, "workItem.url", value.url);
  }
}

function collectTargetIssues(
  issues: RunRequestValidationIssue[],
  value: unknown,
): void {
  if (value === undefined) {
    return;
  }

  if (!isRecord(value)) {
    issues.push({
      path: "target",
      message: "target must be a JSON object.",
    });
    return;
  }

  collectUnknownKeyIssues(issues, value, targetKeys, "target");
  collectEnumIssue(
    issues,
    "target.targetType",
    value.targetType,
    targetTypes,
    "targetType must be one of: repository, workspace, environment, manual.",
  );
  collectTargetIdIssue(issues, value.targetType, value.targetId);
  collectOptionalStringLengthIssue(issues, "target.externalRef", value.externalRef, 1, 240);
}

function collectPolicyContextIssues(
  issues: RunRequestValidationIssue[],
  value: unknown,
): void {
  if (value === undefined) {
    return;
  }

  if (!isRecord(value)) {
    issues.push({
      path: "policyContext",
      message: "policyContext must be a JSON object.",
    });
    return;
  }

  collectUnknownKeyIssues(issues, value, policyContextKeys, "policyContext");

  if (value.policySetId !== undefined) {
    collectPatternIssue(
      issues,
      "policyContext.policySetId",
      value.policySetId,
      policyIdPattern,
      "policySetId must be a valid EIP policy id.",
    );
  }

  if (value.riskClasses !== undefined) {
    if (!Array.isArray(value.riskClasses)) {
      issues.push({
        path: "policyContext.riskClasses",
        message: "riskClasses must be an array.",
      });
    } else {
      if (value.riskClasses.length > 20) {
        issues.push({
          path: "policyContext.riskClasses",
          message: "riskClasses must contain at most 20 items.",
        });
      }

      const seen = new Set<string>();
      for (const [index, riskClass] of value.riskClasses.entries()) {
        collectStringLengthPatternIssue(
          issues,
          `policyContext.riskClasses.${index}`,
          riskClass,
          1,
          80,
          riskClassPattern,
          "risk class must be 1-80 lowercase kebab-case characters.",
        );

        if (typeof riskClass === "string") {
          if (seen.has(riskClass)) {
            issues.push({
              path: `policyContext.riskClasses.${index}`,
              message: "riskClasses entries must be unique.",
            });
          }
          seen.add(riskClass);
        }
      }
    }
  }

  if (value.requiresApproval !== undefined && typeof value.requiresApproval !== "boolean") {
    issues.push({
      path: "policyContext.requiresApproval",
      message: "requiresApproval must be a boolean.",
    });
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
  basePath: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push({
        path: basePath === "$" ? key : `${basePath}.${key}`,
        message: "field is not part of the RunRequest v1 contract.",
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

function collectPatternIssue(
  issues: RunRequestValidationIssue[],
  path: string,
  value: unknown,
  pattern: RegExp,
  message: string,
): void {
  if (typeof value !== "string" || !pattern.test(value)) {
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
): void {
  if (typeof value !== "string" || value.length < minLength || value.length > maxLength) {
    issues.push({
      path,
      message: `${path.split(".").at(-1) ?? path} must be ${minLength}-${maxLength} characters.`,
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

  collectStringLengthIssue(issues, path, value, minLength, maxLength);
}

function collectStringLengthPatternIssue(
  issues: RunRequestValidationIssue[],
  path: string,
  value: unknown,
  minLength: number,
  maxLength: number,
  pattern: RegExp,
  message: string,
): void {
  if (
    typeof value !== "string" ||
    value.length < minLength ||
    value.length > maxLength ||
    !pattern.test(value)
  ) {
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
  if (typeof value !== "string" || !isIsoDateTimeUtc(value)) {
    issues.push({
      path,
      message: `${path} must be a valid ISO 8601 UTC timestamp ending in Z.`,
    });
  }
}

function collectTargetIdIssue(
  issues: RunRequestValidationIssue[],
  targetType: unknown,
  value: unknown,
): void {
  const isRepository = targetType === "repository";

  collectPatternIssue(
    issues,
    "target.targetId",
    value,
    isRepository ? repositoryIdPattern : prefixedIdPattern,
    isRepository
      ? "targetId must be a valid EIP repository id."
      : "targetId must be a valid EIP target id.",
  );
}

function collectHttpsUrlIssue(
  issues: RunRequestValidationIssue[],
  path: string,
  value: unknown,
): void {
  if (typeof value !== "string" || value.length < 1 || value.length > 400) {
    issues.push({
      path,
      message: "url must be an HTTPS URL.",
    });
    return;
  }

  if (!isHttpsUrl(value)) {
    issues.push({
      path,
      message: "url must be an HTTPS URL.",
    });
  }
}

function isIsoDateTimeUtc(value: string): boolean {
  const match = isoDateTimeUtcPattern.exec(value);
  if (!match) {
    return false;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return false;
  }

  const fraction = value.match(/\.(\d+)Z$/)?.[1];
  if (fraction !== undefined && fraction.length > 3) {
    return false;
  }

  const normalized =
    fraction === undefined
      ? value.replace(/Z$/, ".000Z")
      : value.replace(/\.(\d+)Z$/, `.${fraction.padEnd(3, "0")}Z`);

  return new Date(timestamp).toISOString() === normalized;
}

function isHttpsUrl(value: string): boolean {
  if (/\s/.test(value) || !value.startsWith("https://") || value.startsWith("https:///")) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
