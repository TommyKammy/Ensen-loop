import { containsUnsafePublicArtifactText } from "../safety/public-artifact.js";
import type { EvidenceBundleRef, EvidenceBundleMetadataValue } from "./evidence-bundle-ref.js";

export type CustomerLaneEvidenceClassification =
  | "public"
  | "internal"
  | "customer-confidential"
  | "regulated";

export interface CustomerLaneEvidenceValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface CustomerLaneEvidenceValidationSuccess {
  readonly ok: true;
}

export interface CustomerLaneEvidenceValidationFailure {
  readonly ok: false;
  readonly issues: readonly CustomerLaneEvidenceValidationIssue[];
}

export type CustomerLaneEvidenceValidationResult =
  | CustomerLaneEvidenceValidationSuccess
  | CustomerLaneEvidenceValidationFailure;

const allowedClassifications = new Set<unknown>([
  "public",
  "internal",
  "customer-confidential",
  "regulated",
]);
const controlledClassifications = new Set<unknown>(["customer-confidential", "regulated"]);
const allowedCustomerLaneMetadataKeys = new Set([
  "producer",
  "producerBoundary",
  "protocolVersion",
  "validationCommand",
  "artifactKind",
  "referenceKind",
  "evidenceTrack",
  "evidenceBoundary",
  "dataClassification",
  "controlledReference",
  "embedsEvidencePayload",
  "localDevelopmentOnly",
  "writesDurableEvidence",
  "checksumUnavailableReason",
]);
const rawControlledMaterialKeyPattern =
  /(?:^|[A-Z_-])(?:raw|body|content|payload|record|file|credential|password|secret|token|apiKey|customer|tenant|account|repository)(?:$|[A-Z_-])/;
const customerLaneBoundaryValues = new Set<unknown>(["customer-lane", "customer-regulated"]);

export function validateCustomerLaneEvidenceRef(
  evidenceRef: EvidenceBundleRef,
): CustomerLaneEvidenceValidationResult {
  const issues = collectCustomerLaneEvidenceRefIssues(evidenceRef);

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

export function isCustomerLaneEvidenceRef(evidenceRef: EvidenceBundleRef): boolean {
  const metadata = evidenceRef.metadata;

  return metadata !== undefined && hasCustomerLaneEvidenceSignal(metadata);
}

function collectCustomerLaneEvidenceRefIssues(
  evidenceRef: EvidenceBundleRef,
): readonly CustomerLaneEvidenceValidationIssue[] {
  const issues: CustomerLaneEvidenceValidationIssue[] = [];
  const metadata = evidenceRef.metadata;

  if (metadata === undefined) {
    return issues;
  }

  if (!hasCustomerLaneEvidenceSignal(metadata)) {
    return issues;
  }

  if (!allowedClassifications.has(metadata.dataClassification)) {
    issues.push({
      path: "metadata.dataClassification",
      message:
        "Track B customer lane evidence requires an explicit allowed data classification.",
    });
  }

  if (
    isControlledDataClassification(metadata.dataClassification) ||
    metadata.controlledReference === true
  ) {
    collectControlledReferenceMetadataIssues(issues, metadata);
  }

  return issues;
}

function hasCustomerLaneEvidenceSignal(
  metadata: Record<string, EvidenceBundleMetadataValue>,
): boolean {
  return (
    metadata.evidenceTrack === "track-b" ||
    customerLaneBoundaryValues.has(metadata.evidenceBoundary) ||
    isControlledDataClassification(metadata.dataClassification) ||
    metadata.controlledReference === true
  );
}

function isControlledDataClassification(value: EvidenceBundleMetadataValue | undefined): boolean {
  return controlledClassifications.has(value);
}

function collectControlledReferenceMetadataIssues(
  issues: CustomerLaneEvidenceValidationIssue[],
  metadata: Record<string, EvidenceBundleMetadataValue>,
): void {
  if (metadata.embedsEvidencePayload !== false) {
    issues.push({
      path: "metadata.embedsEvidencePayload",
      message: "Track B customer lane evidence references must not embed raw controlled material.",
    });
  }

  for (const [key, value] of Object.entries(metadata)) {
    if (!allowedCustomerLaneMetadataKeys.has(key) || rawControlledMaterialKeyPattern.test(key)) {
      issues.push({
        path: `metadata.${key}`,
        message: "Track B customer lane evidence references must not embed raw controlled material.",
      });
      continue;
    }

    if (typeof value === "string" && containsUnsafePublicArtifactText(value)) {
      issues.push({
        path: `metadata.${key}`,
        message: "Track B customer lane evidence references must not embed raw controlled material.",
      });
    }
  }
}
