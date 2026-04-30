export type EvidenceBundleRefType = "local_path" | "file_uri";

export interface EvidenceBundleChecksum {
  readonly algorithm: "sha256";
  readonly value: string;
}

export type EvidenceBundleMetadataValue = string | number | boolean | null;

export interface EvidenceBundleRef {
  readonly schemaVersion: "eip.evidence-bundle-ref.v1";
  readonly id: string;
  readonly correlationId: string;
  readonly type: EvidenceBundleRefType;
  readonly uri: string;
  readonly createdAt: string;
  readonly contentType?: string;
  readonly checksum?: EvidenceBundleChecksum;
  readonly metadata?: Record<string, EvidenceBundleMetadataValue>;
}

export interface EvidenceBundleRefValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface EvidenceBundleRefValidationSuccess {
  readonly ok: true;
  readonly ref: EvidenceBundleRef;
}

export interface EvidenceBundleRefValidationFailure {
  readonly ok: false;
  readonly issues: readonly EvidenceBundleRefValidationIssue[];
}

export type EvidenceBundleRefValidationResult =
  | EvidenceBundleRefValidationSuccess
  | EvidenceBundleRefValidationFailure;

const evidenceBundleRefKeys = new Set([
  "schemaVersion",
  "id",
  "correlationId",
  "type",
  "uri",
  "createdAt",
  "contentType",
  "checksum",
  "metadata",
]);
const checksumKeys = new Set(["algorithm", "value"]);

const prefixedIdPattern =
  /^(?:actor|artifact|corr|cr|evb|evt|flowstep|policy|pr|repo|req|run|source|sts|workitem)_[A-Za-z0-9][A-Za-z0-9._~-]{5,127}$/;
const correlationIdPattern = /^corr_[A-Za-z0-9][A-Za-z0-9._~-]{11,127}$/;
const isoDateTimeUtcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const contentTypePattern =
  /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*(?:; ?[A-Za-z0-9_.-]+=[A-Za-z0-9_.+-]+)*$/;
const checksumPattern = /^[a-f0-9]{64}$/;
const metadataKeyPattern = /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)*$/;
const credentialUriAuthorityPattern =
  /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#\s]*[^/?#\s:@]+:[^/?#\s:@]+@/;
const localPathPattern = /^(?![A-Za-z][A-Za-z0-9+.-]*:\/\/)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._~@/-]+$/;
const fileUriPattern = /^file:\/\/\/(?!.*(?:^|\/)\.\.(?:\/|$))[^\s?#]+$/;
const evidenceBundleRefTypes = new Set<unknown>(["local_path", "file_uri"]);

export function validateEvidenceBundleRef(value: unknown): EvidenceBundleRefValidationResult {
  const issues = collectEvidenceBundleRefIssues(value);

  if (issues.length > 0) {
    return {
      ok: false,
      issues,
    };
  }

  return {
    ok: true,
    ref: value as EvidenceBundleRef,
  };
}

function collectEvidenceBundleRefIssues(
  value: unknown,
): readonly EvidenceBundleRefValidationIssue[] {
  if (!isRecord(value)) {
    return [
      {
        path: "$",
        message: "EvidenceBundleRef input must be a JSON object.",
      },
    ];
  }

  const issues: EvidenceBundleRefValidationIssue[] = [];

  collectUnknownKeyIssues(issues, value, evidenceBundleRefKeys, "$");
  collectConstIssue(issues, "schemaVersion", value.schemaVersion, "eip.evidence-bundle-ref.v1");
  collectPatternIssue(issues, "id", value.id, prefixedIdPattern, "id must be a valid EIP id.");
  collectPatternIssue(
    issues,
    "correlationId",
    value.correlationId,
    correlationIdPattern,
    "correlationId must be a valid EIP correlation id.",
  );
  collectEnumIssue(
    issues,
    "type",
    value.type,
    evidenceBundleRefTypes,
    "type must be local_path or file_uri.",
  );
  collectUriIssues(issues, value.type, value.uri);
  collectUtcTimestampIssue(issues, "createdAt", value.createdAt);
  collectPatternIssue(
    issues,
    "contentType",
    value.contentType,
    contentTypePattern,
    "contentType must be a valid media type.",
    true,
  );
  collectChecksumIssues(issues, value.checksum);
  collectMetadataIssues(issues, value.metadata);

  return issues;
}

function collectUriIssues(
  issues: EvidenceBundleRefValidationIssue[],
  type: unknown,
  value: unknown,
): void {
  if (typeof value !== "string" || value.length < 1 || value.length > 1000) {
    issues.push({
      path: "uri",
      message: "uri must be a string with length 1-1000.",
    });
    return;
  }

  if (credentialUriAuthorityPattern.test(value)) {
    issues.push({
      path: "uri",
      message: "uri must not contain credential material.",
    });
  }

  if (type === "local_path" && !localPathPattern.test(value)) {
    issues.push({
      path: "uri",
      message: "local_path uri must be relative, traversal-free, and scheme-free.",
    });
  }

  if (type === "file_uri" && !fileUriPattern.test(value)) {
    issues.push({
      path: "uri",
      message: "file_uri uri must be an absolute file URI without traversal, query, or fragment.",
    });
  }
}

function collectChecksumIssues(
  issues: EvidenceBundleRefValidationIssue[],
  value: unknown,
): void {
  if (value === undefined) {
    return;
  }

  if (!isRecord(value)) {
    issues.push({
      path: "checksum",
      message: "checksum must be a JSON object.",
    });
    return;
  }

  collectUnknownKeyIssues(issues, value, checksumKeys, "checksum");
  collectConstIssue(issues, "checksum.algorithm", value.algorithm, "sha256");
  collectPatternIssue(
    issues,
    "checksum.value",
    value.value,
    checksumPattern,
    "checksum.value must be a sha256 digest value.",
  );
}

function collectMetadataIssues(
  issues: EvidenceBundleRefValidationIssue[],
  value: unknown,
): void {
  if (value === undefined) {
    return;
  }

  if (!isRecord(value)) {
    issues.push({
      path: "metadata",
      message: "metadata must be a JSON object.",
    });
    return;
  }

  const entries = Object.entries(value);
  if (entries.length > 20) {
    issues.push({
      path: "metadata",
      message: "metadata must contain at most 20 properties.",
    });
  }

  for (const [key, metadataValue] of entries) {
    if (!metadataKeyPattern.test(key)) {
      issues.push({
        path: `metadata.${key}`,
        message: "metadata keys must be lower camel case.",
      });
    }

    if (
      metadataValue !== null &&
      typeof metadataValue !== "number" &&
      typeof metadataValue !== "boolean" &&
      !(
        typeof metadataValue === "string" &&
        metadataValue.length >= 1 &&
        metadataValue.length <= 500
      )
    ) {
      issues.push({
        path: `metadata.${key}`,
        message: "metadata values must be scalar JSON values.",
      });
    }
  }
}

function collectUnknownKeyIssues(
  issues: EvidenceBundleRefValidationIssue[],
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
  issues: EvidenceBundleRefValidationIssue[],
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
  issues: EvidenceBundleRefValidationIssue[],
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
  issues: EvidenceBundleRefValidationIssue[],
  path: string,
  value: unknown,
  allowed: ReadonlySet<unknown>,
  message: string,
): void {
  if (!allowed.has(value)) {
    issues.push({
      path,
      message,
    });
  }
}

function collectUtcTimestampIssue(
  issues: EvidenceBundleRefValidationIssue[],
  path: string,
  value: unknown,
): void {
  if (typeof value !== "string" || !isoDateTimeUtcPattern.test(value)) {
    issues.push({
      path,
      message: `${path} must be a UTC ISO 8601 timestamp.`,
    });
    return;
  }

  if (Number.isNaN(Date.parse(value))) {
    issues.push({
      path,
      message: `${path} must be a real UTC timestamp.`,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
