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
