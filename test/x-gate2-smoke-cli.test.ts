import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  validateEvidenceBundleRef,
  validateRunResult,
  validateRunStatusSnapshot,
} from "../src/protocol/index.js";

const execFileAsync = promisify(execFile);
const fixtureRoot = path.join(
  "protocol-snapshots",
  "ensen-protocol",
  "v0.1.0",
  "fixtures",
);

test("X-Gate 2 smoke CLI emits deterministic status, result, and evidence ref", async () => {
  const fixturePath = path.join(fixtureRoot, "run-request/v1/valid/github-issue-request.json");

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    "dist/src/cli/index.js",
    "x-gate2-smoke",
    fixturePath,
  ]);

  assert.equal(stderr, "");

  const output = JSON.parse(stdout) as {
    schemaVersion: string;
    boundary: string;
    mutatesRepository: boolean;
    invokesProvider: boolean;
    statusSnapshot: unknown;
    runResult: unknown;
    evidenceBundleRef: unknown;
  };

  assert.equal(output.schemaVersion, "ensen-loop.x-gate2-smoke.v1");
  assert.equal(output.boundary, "local-cli-stdout");
  assert.equal(output.mutatesRepository, false);
  assert.equal(output.invokesProvider, false);

  const snapshot = validateRunStatusSnapshot(output.statusSnapshot);
  const result = validateRunResult(output.runResult);
  const evidenceRef = validateEvidenceBundleRef(output.evidenceBundleRef);

  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.ok && snapshot.snapshot.status, "queued");
  assert.equal(snapshot.ok && snapshot.snapshot.observedAt, "2026-04-29T01:45:46Z");

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.result.status, "succeeded");
  assert.equal(result.ok && result.result.completedAt, "2026-04-29T01:45:47Z");
  assert.deepEqual(result.ok && result.result.evidenceBundles, [
    {
      evidenceBundleId: "evb_01HV7Y8M8F2KQ5W3P9R6T4N2AB",
    },
  ]);

  assert.equal(evidenceRef.ok, true);
  assert.equal(evidenceRef.ok && evidenceRef.ref.type, "local_path");
  assert.equal(
    evidenceRef.ok && evidenceRef.ref.uri,
    "artifacts/evidence/x-gate2/req_01HV7Y8M8F2KQ5W3P9R6T4N2AB.json",
  );
});

test("X-Gate 2 smoke CLI fails closed for unsupported EIP major versions", async () => {
  const fixturePath = path.join(fixtureRoot, "run-request/v1/invalid/bad-schema-version.json");

  await assert.rejects(
    execFileAsync(process.execPath, [
      "dist/src/cli/index.js",
      "x-gate2-smoke",
      fixturePath,
    ]),
    (error: unknown) => {
      assert.ok(error && typeof error === "object");
      assert.ok("code" in error);
      assert.equal(error.code, 1);
      assert.ok("stdout" in error && typeof error.stdout === "string");

      const output = JSON.parse(error.stdout) as {
        statusSnapshot: unknown;
        runResult: unknown;
      };

      const snapshot = validateRunStatusSnapshot(output.statusSnapshot);
      const result = validateRunResult(output.runResult);

      assert.equal(snapshot.ok, true);
      assert.equal(snapshot.ok && snapshot.snapshot.status, "blocked");
      assert.match(snapshot.ok ? (snapshot.snapshot.message ?? "") : "", /schemaVersion/);
      assert.equal(result.ok, true);
      assert.equal(result.ok && result.result.status, "blocked");

      return true;
    },
  );
});
