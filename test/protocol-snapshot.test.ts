import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const snapshotRoot = path.join(
  "protocol-snapshots",
  "ensen-protocol",
  "v0.1.0",
);

const expectedSchemas = [
  "schemas/eip.evidence-bundle-ref.v1.schema.json",
  "schemas/eip.run-request.v1.schema.json",
  "schemas/eip.run-result.v1.schema.json",
  "schemas/eip.run-status.v1.schema.json",
];

const supportSchemas = ["schemas/eip.common.v1.schema.json"];

const expectedFixtureFamilies = [
  "evidence-bundle-ref",
  "run-request",
  "run-result",
  "run-status",
];

async function readJson(relativePath: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(snapshotRoot, relativePath), "utf8")) as unknown;
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

test("vendors the Ensen-protocol v0.1.0 protocol snapshot with provenance", async () => {
  const manifest = await readJson("manifest.json");

  assert.deepEqual(manifest, {
    source: {
      repository: "TommyKammy/Ensen-protocol",
      releaseTag: "v0.1.0",
      protocolVersion: "0.1.0",
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
  for (const fixtureFamily of expectedFixtureFamilies) {
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
