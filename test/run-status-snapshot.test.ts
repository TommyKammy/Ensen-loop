import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  createRunRequestExecutionPlan,
  createRunStatusSnapshot,
  parseRunRequest,
  validateRunStatusSnapshot,
} from "../src/protocol/index.js";

const execFileAsync = promisify(execFile);
const fixtureRoot = path.join(
  "protocol-snapshots",
  "ensen-protocol",
  "v0.2.0",
  "fixtures",
);

async function readJson(relativePath: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(fixtureRoot, relativePath), "utf8")) as unknown;
}

test("emits RunStatusSnapshot-compatible dry-run lifecycle states", async () => {
  const request = parseRunRequest(await readJson("run-request/v1/valid/github-issue-request.json"));
  const plan = createRunRequestExecutionPlan(request);

  const accepted = createRunStatusSnapshot(plan, {
    status: "accepted",
    observedAt: "2026-04-30T00:00:00Z",
  });
  const queued = createRunStatusSnapshot(plan, {
    status: "queued",
    observedAt: "2026-04-30T00:00:01Z",
  });
  const running = createRunStatusSnapshot(plan, {
    status: "running",
    observedAt: "2026-04-30T00:00:02Z",
  });

  assert.deepEqual(
    [accepted, queued, running].map((snapshot) => validateRunStatusSnapshot(snapshot).ok),
    [true, true, true],
  );
  assert.equal(accepted.schemaVersion, "eip.run-status.v1");
  assert.equal(accepted.id, "sts_01HV7Y8M8F2KQ5W3P9R6T4N2AB");
  assert.equal(accepted.requestId, request.id);
  assert.equal(accepted.correlationId, request.correlationId);
  assert.equal(accepted.runId, undefined);
  assert.equal(queued.runId, "run_01HV7Y8M8F2KQ5W3P9R6T4N2AB");
  assert.equal(running.runId, "run_01HV7Y8M8F2KQ5W3P9R6T4N2AB");
  assert.deepEqual(running.progress, {
    current: 0,
    total: 1,
    percent: 0,
    unit: "dry-run",
  });
});

test("rejects crossed ID prefixes in RunStatusSnapshot payloads", async () => {
  const request = parseRunRequest(await readJson("run-request/v1/valid/github-issue-request.json"));
  const plan = createRunRequestExecutionPlan(request);
  const snapshot = createRunStatusSnapshot(plan, {
    status: "queued",
    observedAt: "2026-04-30T00:00:01Z",
  });

  const result = validateRunStatusSnapshot({
    ...snapshot,
    id: snapshot.runId,
    requestId: snapshot.runId,
    runId: snapshot.id,
  });

  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => issue.path === "id"),
    "status id must require an sts_ prefix",
  );
  assert.ok(
    result.issues.some((issue) => issue.path === "requestId"),
    "request id must require a req_ prefix",
  );
  assert.ok(
    result.issues.some((issue) => issue.path === "runId"),
    "run id must require a run_ prefix",
  );
});

test("includes blocked dry-run reasons without final-result-only fields", async () => {
  const request = parseRunRequest(await readJson("run-request/v1/valid/manual-request.json"));
  const plan = createRunRequestExecutionPlan(request);

  const snapshot = createRunStatusSnapshot(plan, {
    status: "blocked",
    observedAt: "2026-04-30T00:00:03Z",
  });

  assert.equal(validateRunStatusSnapshot(snapshot).ok, true);
  assert.equal(snapshot.status, "blocked");
  assert.equal(snapshot.runId, undefined);
  assert.match(snapshot.message ?? "", /target is required/);
  assert.deepEqual(snapshot.extensions, {
    "x-ensen-loop-blocked-reasons": [
      "target is required before execution can be planned",
      "policyContext is required before execution can be planned",
    ],
  });
  assert.equal(Object.hasOwn(snapshot, "completedAt"), false);
  assert.equal(Object.hasOwn(snapshot, "changeRequests"), false);
});

test("rejects final-result-only fields in RunStatusSnapshot payloads", async () => {
  const invalid = await readJson("run-status/v1/invalid/final-result-only-fields.json");

  const result = validateRunStatusSnapshot(invalid);

  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => issue.path === "completedAt"),
    "completedAt must be rejected as a status snapshot field",
  );
  assert.ok(
    result.issues.some((issue) => issue.path === "changeRequests"),
    "changeRequests must be rejected as a status snapshot field",
  );
});

test("CLI emits RunStatusSnapshot JSON for dry-run RunRequest mode", async () => {
  const fixturePath = path.join(fixtureRoot, "run-request/v1/valid/github-issue-request.json");

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    "dist/src/cli/index.js",
    "run-request",
    fixturePath,
    "--status-snapshot",
    "queued",
  ]);

  assert.equal(stderr, "");

  const snapshot = JSON.parse(stdout) as unknown;
  const result = validateRunStatusSnapshot(snapshot);

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.snapshot.status, "queued");
});

test("CLI emits blocked RunStatusSnapshot JSON when validation fails after stable ids", async () => {
  const fixturePath = path.join(
    fixtureRoot,
    "run-request/v1/invalid/bad-schema-version.json",
  );

  await assert.rejects(
    execFileAsync(process.execPath, [
      "dist/src/cli/index.js",
      "run-request",
      fixturePath,
      "--status-snapshot",
      "queued",
    ]),
    (error: unknown) => {
      assert.ok(error && typeof error === "object");
      assert.ok("code" in error);
      assert.equal(error.code, 1);
      assert.ok("stdout" in error && typeof error.stdout === "string");

      const snapshot = JSON.parse(error.stdout) as unknown;
      const result = validateRunStatusSnapshot(snapshot);

      assert.equal(result.ok, true);
      assert.equal(result.ok && result.snapshot.status, "blocked");
      assert.match(result.ok ? (result.snapshot.message ?? "") : "", /schemaVersion/);

      return true;
    },
  );
});
