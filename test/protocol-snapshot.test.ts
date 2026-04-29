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
    },
    includes: {
      schemas: expectedSchemas,
      supportSchemas,
      fixtureFamilies: expectedFixtureFamilies,
    },
  });

  for (const schemaPath of [...expectedSchemas, ...supportSchemas]) {
    const schema = await readJson(schemaPath);

    assert.equal(typeof schema, "object", `${schemaPath} must contain a JSON object`);
  }
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
