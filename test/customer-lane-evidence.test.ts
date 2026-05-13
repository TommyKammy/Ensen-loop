import assert from "node:assert/strict";
import test from "node:test";

import {
  isCustomerLaneEvidenceRef,
  validateCustomerLaneEvidenceRef,
  type EvidenceBundleRef,
} from "../src/protocol/index.js";

const safeEvidenceRef: EvidenceBundleRef = {
  schemaVersion: "eip.evidence-bundle-ref.v1",
  id: "evb_issue98ValidatorEvidence01",
  correlationId: "corr_issue98ValidatorEvidence01",
  type: "local_path",
  uri: "artifacts/evidence/issue-98/bundle-ref.json",
  createdAt: "2026-05-13T00:00:00Z",
  contentType: "application/json",
  metadata: {
    producer: "ensen-loop",
    artifactKind: "phase4ArtifactEvidenceReference",
    embedsEvidencePayload: false,
  },
};

test("treats controlled classifications as customer-lane evidence signals", () => {
  for (const dataClassification of ["customer-confidential", "regulated"]) {
    const evidenceRef: EvidenceBundleRef = {
      ...safeEvidenceRef,
      metadata: {
        ...safeEvidenceRef.metadata,
        dataClassification,
        embedsEvidencePayload: false,
      },
    };

    assert.equal(
      isCustomerLaneEvidenceRef(evidenceRef),
      true,
      `${dataClassification} must not bypass the Track B customer-lane guard`,
    );
    assert.deepEqual(validateCustomerLaneEvidenceRef(evidenceRef), { ok: true });
  }
});

test("fails closed when controlled classification-only references embed raw metadata", () => {
  const result = validateCustomerLaneEvidenceRef({
    ...safeEvidenceRef,
    metadata: {
      ...safeEvidenceRef.metadata,
      dataClassification: "regulated",
      embedsEvidencePayload: false,
      rawCustomerRecord: "synthetic customer record",
    },
  });

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.deepEqual(
      result.issues.map((issue) => issue.path),
      ["metadata.rawCustomerRecord"],
    );
  }
});

test("fails closed when customer-regulated boundary uses public classification", () => {
  const result = validateCustomerLaneEvidenceRef({
    ...safeEvidenceRef,
    metadata: {
      ...safeEvidenceRef.metadata,
      evidenceTrack: "track-b",
      evidenceBoundary: "customer-regulated",
      dataClassification: "public",
      embedsEvidencePayload: false,
    },
  });

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.deepEqual(
      result.issues.map((issue) => issue.path),
      ["metadata.dataClassification"],
    );
  }
});

test("fails closed when controlledReference is malformed", () => {
  const result = validateCustomerLaneEvidenceRef({
    ...safeEvidenceRef,
    metadata: {
      ...safeEvidenceRef.metadata,
      controlledReference: "true",
      embedsEvidencePayload: false,
    },
  });

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.deepEqual(
      result.issues.map((issue) => issue.path),
      ["metadata.dataClassification", "metadata.controlledReference"],
    );
  }
});

test("rejects free-form values in controlled metadata fields", () => {
  for (const [key, value] of [
    ["producer", "customer order for Alice"],
    ["referenceKind", "customer order for Alice"],
    ["validationCommand", "customer order for Alice"],
  ] as const) {
    const result = validateCustomerLaneEvidenceRef({
      ...safeEvidenceRef,
      metadata: {
        ...safeEvidenceRef.metadata,
        dataClassification: "regulated",
        embedsEvidencePayload: false,
        [key]: value,
      },
    });

    assert.equal(result.ok, false, `${key} must reject free-form controlled text`);

    if (!result.ok) {
      assert.ok(
        result.issues.some((issue) => issue.path === `metadata.${key}`),
        `${key} rejection must point at the controlled metadata field`,
      );
    }
  }
});

test("accepts bounded values in controlled metadata fields", () => {
  const result = validateCustomerLaneEvidenceRef({
    ...safeEvidenceRef,
    metadata: {
      ...safeEvidenceRef.metadata,
      protocolVersion: "0.4.0",
      validationCommand: "npm test",
      evidenceTrack: "track-b",
      evidenceBoundary: "customer-lane",
      dataClassification: "regulated",
      referenceKind: "controlledEvidenceReference",
      controlledReference: true,
      embedsEvidencePayload: false,
    },
  });

  assert.deepEqual(result, { ok: true });
});
