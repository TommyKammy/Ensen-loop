import { containsUnsafePublicArtifactText } from "../safety/public-artifact.js";

export interface OperationalEvidenceProfileValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface OperationalEvidenceProfileValidationSuccess {
  readonly ok: true;
}

export interface OperationalEvidenceProfileValidationFailure {
  readonly ok: false;
  readonly issues: readonly OperationalEvidenceProfileValidationIssue[];
}

export type OperationalEvidenceProfileValidationResult =
  | OperationalEvidenceProfileValidationSuccess
  | OperationalEvidenceProfileValidationFailure;

const topLevelKeys = new Set([
  "profile",
  "scenario",
  "track",
  "boundary",
  "evidence",
  "producerMetadata",
  "retentionHint",
  "confidentialReferencePolicy",
  "nonGoals",
]);
const evidenceKeys = new Set([
  "dataClassification",
  "referenceKind",
  "uri",
  "contentType",
  "checksum",
]);
const checksumKeys = new Set(["algorithm", "value"]);
const producerMetadataKeys = new Set([
  "producer",
  "producerVersion",
  "protocolVersion",
  "command",
  "boundary",
  "createdBy",
]);
const confidentialReferencePolicyKeys = new Set([
  "allowedInPublicFixture",
  "placeholder",
  "guidance",
]);
const advisoryRetentionHints = new Set([
  "publicFixture",
  "localEphemeral",
  "localRetained",
  "externalControlled",
]);
const credentialLikeKeyPattern =
  /(?:^|[-_])(?:authorization|cookie|credential|password|passwd|secret|session|token|api[-_]?key|apikey)(?:$|[-_])/i;
const privateScopeKeyPattern =
  /^(?:customer|customerId|organization|owner|privateRepo|repository|repositorySlug|repo|tenant|tenantId)$/i;
const credentialUriAuthorityPattern =
  /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#\s]*[^/?#\s:@]+:[^/?#\s:@]+@/;
const privateRepositoryDetailPatterns: readonly RegExp[] = [
  /\b(?:https?:\/\/)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]*(?:private|customer|tenant|confidential|internal)[A-Za-z0-9_.-]*(?=$|[\s"'`<>)\]}?,.;:/#])/i,
  /\bgit@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]*(?:private|customer|tenant|confidential|internal)[A-Za-z0-9_.-]*(?:\.git)?(?=$|[\s"'`<>)\]}?,.;:/#])/i,
];
const publicEvidenceUriPattern =
  /^artifacts\/evidence\/(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._~@/-]+$/;
const contentTypePattern =
  /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*(?:; ?[A-Za-z0-9_.-]+=[A-Za-z0-9_.+-]+)*$/;
const checksumPattern = /^[a-f0-9]{64}$/;

export function validateOperationalEvidenceProfile(
  value: unknown,
): OperationalEvidenceProfileValidationResult {
  const issues = collectOperationalEvidenceProfileIssues(value);

  if (issues.length > 0) {
    return {
      ok: false,
      issues,
    };
  }

  return {
    ok: true,
  };
}

function collectOperationalEvidenceProfileIssues(
  value: unknown,
): readonly OperationalEvidenceProfileValidationIssue[] {
  if (!isRecord(value)) {
    return [
      {
        path: "$",
        message: "Operational evidence profile must be a JSON object.",
      },
    ];
  }

  const issues: OperationalEvidenceProfileValidationIssue[] = [];

  collectUnknownKeyIssues(issues, value, topLevelKeys, "$");
  collectConstIssue(issues, "profile", value.profile, "operational-evidence-profile.v1");
  collectConstIssue(issues, "scenario", value.scenario, "public-fixture-safe-artifact");
  collectConstIssue(issues, "track", value.track, "X-Gate 3 Track A");
  collectConstIssue(issues, "boundary", value.boundary, "owner-controlled repo / solo dogfood");
  collectEvidenceIssues(issues, value.evidence);
  collectProducerMetadataIssues(issues, value.producerMetadata);
  collectRetentionHintIssues(issues, value.retentionHint);
  collectConfidentialReferencePolicyIssues(issues, value.confidentialReferencePolicy);
  collectNonGoalsIssues(issues, value.nonGoals);
  collectPublicSerializationIssues(issues, value);

  return issues;
}

function collectEvidenceIssues(
  issues: OperationalEvidenceProfileValidationIssue[],
  value: unknown,
): void {
  if (!isRecord(value)) {
    issues.push({
      path: "evidence",
      message: "Operational evidence profile requires public evidence metadata.",
    });
    return;
  }

  collectUnknownKeyIssues(issues, value, evidenceKeys, "evidence");
  collectConstIssue(issues, "evidence.dataClassification", value.dataClassification, "public");
  collectConstIssue(
    issues,
    "evidence.referenceKind",
    value.referenceKind,
    "publicFixtureSafeArtifact",
  );

  if (
    typeof value.uri !== "string" ||
    value.uri.length < 1 ||
    value.uri.length > 500 ||
    !publicEvidenceUriPattern.test(value.uri) ||
    containsUnsafePublicString(value.uri)
  ) {
    issues.push({
      path: "evidence.uri",
      message:
        "Public fixture evidence URI must be a safe repo-relative artifacts/evidence path.",
    });
  }

  if (
    value.contentType !== undefined &&
    (typeof value.contentType !== "string" || !contentTypePattern.test(value.contentType))
  ) {
    issues.push({
      path: "evidence.contentType",
      message: "Public fixture evidence contentType must be a valid media type.",
    });
  }

  collectChecksumIssues(issues, value.checksum);
}

function collectChecksumIssues(
  issues: OperationalEvidenceProfileValidationIssue[],
  value: unknown,
): void {
  if (value === undefined) {
    return;
  }

  if (!isRecord(value)) {
    issues.push({
      path: "evidence.checksum",
      message: "Public fixture checksum must be a JSON object.",
    });
    return;
  }

  collectUnknownKeyIssues(issues, value, checksumKeys, "evidence.checksum");
  collectConstIssue(issues, "evidence.checksum.algorithm", value.algorithm, "sha256");

  if (typeof value.value !== "string" || !checksumPattern.test(value.value)) {
    issues.push({
      path: "evidence.checksum.value",
      message: "Public fixture checksum value must be a lowercase sha256 digest.",
    });
  }
}

function collectProducerMetadataIssues(
  issues: OperationalEvidenceProfileValidationIssue[],
  value: unknown,
): void {
  if (!isRecord(value)) {
    issues.push({
      path: "producerMetadata",
      message: "Operational evidence profile requires bounded public producer metadata.",
    });
    return;
  }

  collectUnknownKeyIssues(issues, value, producerMetadataKeys, "producerMetadata");

  for (const [key, metadataValue] of Object.entries(value)) {
    const path = `producerMetadata.${key}`;

    if (credentialLikeKeyPattern.test(key) || privateScopeKeyPattern.test(key)) {
      issues.push({
        path,
        message: "Producer metadata must stay bounded to public non-credential facts.",
      });
      continue;
    }

    if (
      typeof metadataValue !== "string" ||
      metadataValue.length < 1 ||
      metadataValue.length > 200 ||
      containsUnsafePublicString(metadataValue)
    ) {
      issues.push({
        path,
        message: "Producer metadata values must be safe public strings.",
      });
    }
  }
}

function collectRetentionHintIssues(
  issues: OperationalEvidenceProfileValidationIssue[],
  value: unknown,
): void {
  if (typeof value !== "string" || !advisoryRetentionHints.has(value)) {
    issues.push({
      path: "retentionHint",
      message: "Retention hint must be an advisory handling label.",
    });
  }
}

function collectConfidentialReferencePolicyIssues(
  issues: OperationalEvidenceProfileValidationIssue[],
  value: unknown,
): void {
  if (!isRecord(value)) {
    issues.push({
      path: "confidentialReferencePolicy",
      message:
        "Operational evidence profile requires placeholder-only confidential reference policy.",
    });
    return;
  }

  collectUnknownKeyIssues(
    issues,
    value,
    confidentialReferencePolicyKeys,
    "confidentialReferencePolicy",
  );

  if (value.allowedInPublicFixture !== false) {
    issues.push({
      path: "confidentialReferencePolicy.allowedInPublicFixture",
      message: "Confidential references are not publishable public fixture evidence.",
    });
  }

  if (
    typeof value.placeholder !== "string" ||
    !/^<[a-z0-9-]+>(?:\/[A-Za-z0-9._~@-]+)+$/.test(value.placeholder) ||
    containsUnsafePublicString(value.placeholder)
  ) {
    issues.push({
      path: "confidentialReferencePolicy.placeholder",
      message: "Confidential references in public fixtures must use placeholders only.",
    });
  }

  if (
    value.guidance !== undefined &&
    (typeof value.guidance !== "string" ||
      value.guidance.length < 1 ||
      value.guidance.length > 500 ||
      containsUnsafePublicString(value.guidance))
  ) {
    issues.push({
      path: "confidentialReferencePolicy.guidance",
      message: "Confidential reference guidance must be a safe public string.",
    });
  }
}

function collectNonGoalsIssues(
  issues: OperationalEvidenceProfileValidationIssue[],
  value: unknown,
): void {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.length < 1)
  ) {
    issues.push({
      path: "nonGoals",
      message: "Operational evidence profile non-goals must be public string labels.",
    });
  }
}

function collectPublicSerializationIssues(
  issues: OperationalEvidenceProfileValidationIssue[],
  value: Record<string, unknown>,
): void {
  if (containsUnsafeKey(value)) {
    issues.push({
      path: "$",
      message: "Public operational evidence profile must not contain credential-like fields.",
    });
    return;
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    issues.push({
      path: "$",
      message: "Public operational evidence profile must be JSON-serializable.",
    });
    return;
  }

  if (containsUnsafePublicString(serialized)) {
    issues.push({
      path: "$",
      message:
        "Public operational evidence profile must not contain secrets, credential URIs, or workstation-local paths.",
    });
  }
}

function collectUnknownKeyIssues(
  issues: OperationalEvidenceProfileValidationIssue[],
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
  issues: OperationalEvidenceProfileValidationIssue[],
  path: string,
  value: unknown,
  expected: string,
): void {
  if (value !== expected) {
    issues.push({
      path,
      message: `${path} must match the public operational evidence profile.`,
    });
  }
}

function containsUnsafePublicString(value: string): boolean {
  const placeholderSafeValue = value.replace(
    /<[a-z0-9-]+>(?:\/[A-Za-z0-9._~@-]+)+/gi,
    "<placeholder-path>",
  );

  return (
    containsUnsafePublicArtifactText(placeholderSafeValue) ||
    credentialUriAuthorityPattern.test(placeholderSafeValue) ||
    containsPrivateRepositoryDetail(placeholderSafeValue)
  );
}

function containsPrivateRepositoryDetail(value: string): boolean {
  return privateRepositoryDetailPatterns.some((pattern) => pattern.test(value));
}

function containsUnsafeKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsUnsafeKey(item));
  }

  if (!isRecord(value)) {
    return false;
  }

  return Object.entries(value).some(([key, childValue]) => {
    return credentialLikeKeyPattern.test(key) || containsUnsafeKey(childValue);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
