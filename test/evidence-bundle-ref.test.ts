import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  createSampleDryRunExecutionPlan,
  validateEvidenceBundleRef,
} from "../src/index.js";

const fixtureRoot = path.join(
  "protocol-snapshots",
  "ensen-protocol",
  "v0.1.0",
  "fixtures",
  "evidence-bundle-ref",
  "v1",
);

async function readJson(relativePath: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(fixtureRoot, relativePath), "utf8")) as unknown;
}

test("accepts copied EvidenceBundleRef fixtures at the Ensen-loop boundary", async () => {
  for (const fixturePath of ["valid/local-path.json", "valid/file-uri.json"]) {
    const result = validateEvidenceBundleRef(await readJson(fixturePath));

    assert.equal(result.ok, true, `${fixturePath} must pass validation`);
  }
});

test("rejects unsafe EvidenceBundleRef paths and secret-bearing URI shapes", async () => {
  const unsafeExamples = [
    {
      schemaVersion: "eip.evidence-bundle-ref.v1",
      id: "evb_01HV9ZX8J2K6T3QW4R5Y7M8N9U",
      correlationId: "corr_01HV9ZX8J2K6T3QW4R5Y7M8N9R",
      type: "local_path",
      uri: "../evidence/bundle.json",
      createdAt: "2026-04-29T00:10:00Z",
    },
    {
      schemaVersion: "eip.evidence-bundle-ref.v1",
      id: "evb_01HV9ZX8J2K6T3QW4R5Y7M8N9U",
      correlationId: "corr_01HV9ZX8J2K6T3QW4R5Y7M8N9R",
      type: "local_path",
      uri: "/var/lib/ensen/evidence/bundle.json",
      createdAt: "2026-04-29T00:10:00Z",
    },
    {
      schemaVersion: "eip.evidence-bundle-ref.v1",
      id: "evb_01HV9ZX8J2K6T3QW4R5Y7M8N9U",
      correlationId: "corr_01HV9ZX8J2K6T3QW4R5Y7M8N9R",
      type: "file_uri",
      uri: "file:///evidence.example.test/bundle.json?token=REDACTED_FIXTURE_SECRET_PLACEHOLDER",
      createdAt: "2026-04-29T00:10:00Z",
    },
  ];

  for (const example of unsafeExamples) {
    const result = validateEvidenceBundleRef(example);

    assert.equal(result.ok, false, `${example.uri} must fail closed`);
  }

  const invalidFixture = validateEvidenceBundleRef(await readJson("invalid/raw-secret-uri.json"));

  assert.equal(invalidFixture.ok, false, "invalid copied fixture must fail validation");
});

test("dry-run sample exposes validation-ready EvidenceBundleRef references", () => {
  const plan = createSampleDryRunExecutionPlan();

  assert.equal(plan.evidence.writesDurableEvidence, false);
  assert.ok(plan.evidence.bundleRefs.length > 0);

  for (const bundleRef of plan.evidence.bundleRefs) {
    const result = validateEvidenceBundleRef(bundleRef);

    assert.equal(result.ok, true, `${bundleRef.uri} must be EvidenceBundleRef-compatible`);
  }
});
