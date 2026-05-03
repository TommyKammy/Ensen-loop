import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const snapshotRoot = path.join(
  "protocol-snapshots",
  "ensen-protocol",
  "v0.2.0",
);
const operationalEvidenceSnapshotRoot = path.join(
  "protocol-snapshots",
  "ensen-protocol",
  "v0.3.0",
);

const expectedSchemas = [
  "schemas/eip.evidence-bundle-ref.v1.schema.json",
  "schemas/eip.run-request.v1.schema.json",
  "schemas/eip.run-result.v1.schema.json",
  "schemas/eip.run-status.v1.schema.json",
];

const supportSchemas = ["schemas/eip.common.v1.schema.json"];

const expectedFixtureFamilies = [
  "capability-variants",
  "evidence-bundle-ref",
  "run-request",
  "run-result",
  "run-status",
];

async function readJson(relativePath: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(snapshotRoot, relativePath), "utf8")) as unknown;
}

async function readOperationalEvidenceSnapshotJson(relativePath: string): Promise<unknown> {
  return JSON.parse(
    await readFile(path.join(operationalEvidenceSnapshotRoot, relativePath), "utf8"),
  ) as unknown;
}

function assertJsonObject(value: unknown, message: string): asserts value is Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), message);
}

async function listJsonFixtures(relativePath: string): Promise<string[]> {
  const entries = await readdir(path.join(snapshotRoot, relativePath), {
    withFileTypes: true,
  });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
}

test("vendors the Ensen-protocol v0.2.0 protocol snapshot with provenance", async () => {
  const manifest = await readJson("manifest.json");

  assert.deepEqual(manifest, {
    source: {
      repository: "TommyKammy/Ensen-protocol",
      releaseTag: "v0.2.0",
      protocolVersion: "0.2.0",
    },
    policy: {
      updatePolicy:
        "Copied snapshot. Update only by replacing this directory from a tagged Ensen-protocol release.",
      runtimeDependency: false,
      localCorrections: [
        {
          path: "fixtures/evidence-bundle-ref/v1/invalid/raw-secret-uri.json",
          reason: "Use a scanner-safe invalid URI placeholder.",
        },
        {
          path: "fixtures/run-request/v1/invalid/raw-secret.json",
          reason:
            "Keep the invalid fixture deterministically invalid under ExtensionMap rules.",
        },
        {
          path: "schemas/eip.run-result.v1.schema.json",
          reason:
            "Require VerificationSummary.status for unambiguous verification payloads.",
        },
        {
          path: "fixtures/capability-variants/v1/valid/*.json",
          reason:
            "Identify the copied consumer snapshot provenance as Ensen-protocol v0.2.0.",
        },
      ],
    },
    includes: {
      schemas: expectedSchemas,
      supportSchemas,
      fixtureFamilies: expectedFixtureFamilies,
    },
  });

  for (const schemaPath of [...expectedSchemas, ...supportSchemas]) {
    const schema = await readJson(schemaPath);

    assertJsonObject(schema, `${schemaPath} must contain a non-null JSON object`);
  }
});

test("keeps local protocol snapshot corrections explicit", async () => {
  const evidenceBundleRef = await readJson(
    "fixtures/evidence-bundle-ref/v1/invalid/raw-secret-uri.json",
  );
  assertJsonObject(evidenceBundleRef, "raw-secret-uri fixture must be a JSON object");
  const uri = evidenceBundleRef.uri;

  assert.ok(typeof uri === "string", "raw-secret-uri fixture must contain a URI string");
  assert.doesNotMatch(
    uri,
    /:\/\/[^/?#\s]+:[^/?#\s]+@/,
    "raw-secret-uri fixture must not use a credential-shaped URI",
  );

  const rawSecretRunRequest = await readJson("fixtures/run-request/v1/invalid/raw-secret.json");
  assertJsonObject(rawSecretRunRequest, "raw-secret fixture must be a JSON object");
  const extensions = rawSecretRunRequest.extensions;
  assertJsonObject(extensions, "raw-secret fixture extensions must be a JSON object");

  assert.equal(
    extensions["raw-secret"],
    "REDACTED_FIXTURE_SECRET_PLACEHOLDER",
    "raw-secret fixture must use a schema-invalid extension key",
  );
  assert.equal(
    Object.hasOwn(extensions, "x-raw-secret"),
    false,
    "raw-secret fixture must not use the valid x-* extension key pattern",
  );

  const runResultSchema = await readJson("schemas/eip.run-result.v1.schema.json");
  assertJsonObject(runResultSchema, "RunResult schema must be a JSON object");
  const defs = runResultSchema.$defs;
  assertJsonObject(defs, "RunResult schema must define $defs");
  const verificationSummary = defs.VerificationSummary;
  assertJsonObject(
    verificationSummary,
    "RunResult schema must define VerificationSummary as a JSON object",
  );

  assert.deepEqual(
    verificationSummary.required,
    ["status"],
    "VerificationSummary must require status",
  );
});

test("includes valid and invalid fixtures for each required EIP surface", async () => {
  for (const fixtureFamily of expectedFixtureFamilies.filter(
    (family) => family !== "capability-variants",
  )) {
    const validFixtures = await listJsonFixtures(
      path.join("fixtures", fixtureFamily, "v1", "valid"),
    );
    const invalidFixtures = await listJsonFixtures(
      path.join("fixtures", fixtureFamily, "v1", "invalid"),
    );

    assert.ok(
      validFixtures.length > 0,
      `${fixtureFamily} must include at least one valid fixture`,
    );
    assert.ok(
      invalidFixtures.length > 0,
      `${fixtureFamily} must include at least one invalid fixture`,
    );
  }
});

test("includes protocol v0.2.0 capability variant fixtures without changing EIP schema major", async () => {
  const validFixtures = await listJsonFixtures(
    path.join("fixtures", "capability-variants", "v1", "valid"),
  );

  assert.deepEqual(validFixtures, [
    "evidence-unavailable.json",
    "fully-supported-transport.json",
    "retryability-examples.json",
    "submit-only-no-polling.json",
    "unsupported-cancel.json",
  ]);

  for (const fixtureName of validFixtures) {
    const fixture = await readJson(
      path.join("fixtures", "capability-variants", "v1", "valid", fixtureName),
    );
    assertJsonObject(fixture, `${fixtureName} must be a JSON object`);
    assert.equal(fixture.schemaVersion, "eip.capability-variant.example.v1");

    const protocolSnapshot = fixture.protocolSnapshot;
    assertJsonObject(protocolSnapshot, `${fixtureName} protocolSnapshot must be a JSON object`);
    assert.equal(protocolSnapshot.tag, "v0.2.0");
  }

  const runRequestSchema = await readJson("schemas/eip.run-request.v1.schema.json");
  const runResultSchema = await readJson("schemas/eip.run-result.v1.schema.json");

  assertJsonObject(runRequestSchema, "RunRequest schema must be a JSON object");
  assertJsonObject(runResultSchema, "RunResult schema must be a JSON object");
  assert.equal(
    runRequestSchema.$id,
    "https://eip.ensen.dev/schemas/eip.run-request.v1.schema.json",
  );
  assert.equal(
    runResultSchema.$id,
    "https://eip.ensen.dev/schemas/eip.run-result.v1.schema.json",
  );
});

test("vendors the Ensen-protocol v0.3.0 Track A operational evidence profile fixture", async () => {
  const manifest = await readOperationalEvidenceSnapshotJson("manifest.json");

  assert.deepEqual(manifest, {
    source: {
      repository: "TommyKammy/Ensen-protocol",
      releaseTag: "v0.3.0",
      protocolVersion: "0.3.0",
      sourceIssue: "https://github.com/TommyKammy/Ensen-protocol/issues/50",
      sourcePullRequest: "https://github.com/TommyKammy/Ensen-protocol/pull/51",
      sourceMergeCommit: "c33277e5a470883493f10f2c6951a0ca0d5818b0",
    },
    policy: {
      updatePolicy:
        "Copied Track A guidance. Update only by replacing this directory from a tagged Ensen-protocol release.",
      runtimeDependency: false,
      integrationKind: "local conformance evidence",
      boundary: "owner-controlled repo / solo dogfood",
    },
    includes: {
      guidance: ["docs/integration/operational-evidence-profile.md"],
      fixtureLikeExamples: [
        "fixtures/operational-evidence-profile/v1/valid/public-fixture-safe-profile.json",
      ],
    },
  });

  const profile = await readOperationalEvidenceSnapshotJson(
    "fixtures/operational-evidence-profile/v1/valid/public-fixture-safe-profile.json",
  );
  assertJsonObject(profile, "operational evidence profile fixture must be a JSON object");
  assert.equal(profile.profile, "operational-evidence-profile.v1");
  assert.equal(profile.track, "X-Gate 3 Track A");
  assert.equal(profile.boundary, "owner-controlled repo / solo dogfood");

  const evidence = profile.evidence;
  assertJsonObject(evidence, "operational evidence fixture evidence must be a JSON object");
  assert.equal(evidence.dataClassification, "public");
  assert.equal(evidence.referenceKind, "publicFixtureSafeArtifact");
  assert.equal(evidence.uri, "artifacts/evidence/synthetic-run/bundle.json");

  const checksum = evidence.checksum;
  assertJsonObject(checksum, "operational evidence fixture checksum must be a JSON object");
  assert.equal(checksum.algorithm, "sha256");
  assert.equal(
    checksum.value,
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  );

  const producerMetadata = profile.producerMetadata;
  assertJsonObject(
    producerMetadata,
    "operational evidence fixture producerMetadata must be a JSON object",
  );
  assert.equal(producerMetadata.producer, "ensen-loop");
  assert.equal(producerMetadata.command, "npm test");
  assert.equal(profile.retentionHint, "publicFixture");

  const confidentialReferencePolicy = profile.confidentialReferencePolicy;
  assertJsonObject(
    confidentialReferencePolicy,
    "operational evidence fixture confidentialReferencePolicy must be a JSON object",
  );
  assert.equal(confidentialReferencePolicy.allowedInPublicFixture, false);
  assert.equal(confidentialReferencePolicy.placeholder, "<evidence-root>/private-run/bundle.json");

  const serializedProfile = JSON.stringify(profile);
  assert.doesNotMatch(serializedProfile, /\/Users\/|\/home\/|C:\\Users\\/);
  assert.doesNotMatch(serializedProfile, /:\/\/[^/?#\s]+:[^/?#\s]+@/);
  assert.doesNotMatch(serializedProfile, /\b(?:token|secret|password|api[_-]?key)\b\s*[:=]/i);
});
