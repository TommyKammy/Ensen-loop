import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  createRunRequestExecutionPlan,
  createRunResult,
  parseRunRequest,
  validateRunResult,
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

test("emits RunResult-compatible dry-run terminal outputs", async () => {
  const readyRequest = parseRunRequest(
    await readJson("run-request/v1/valid/github-issue-request.json"),
  );
  const readyPlan = createRunRequestExecutionPlan(readyRequest);

  const succeeded = createRunResult(readyPlan, {
    status: "succeeded",
    completedAt: "2026-04-30T00:00:04Z",
  });

  assert.equal(validateRunResult(succeeded).ok, true);
  assert.equal(succeeded.schemaVersion, "eip.run-result.v1");
  assert.equal(succeeded.id, "run_01HV7Y8M8F2KQ5W3P9R6T4N2AB");
  assert.equal(succeeded.requestId, readyRequest.id);
  assert.equal(succeeded.correlationId, readyRequest.correlationId);
  assert.equal(succeeded.status, "succeeded");
  assert.deepEqual(succeeded.verification, {
    status: "not_run",
    summary: "Dry-run completed without running verification commands.",
  });
  assert.equal(Object.hasOwn(succeeded, "changeRequests"), false);
  assert.equal(Object.hasOwn(succeeded, "evidenceBundles"), false);

  const failed = createRunResult(readyPlan, {
    status: "failed",
    completedAt: "2026-04-30T00:00:05Z",
  });

  assert.equal(validateRunResult(failed).ok, true);
  assert.equal(failed.requestId, readyRequest.id);
  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.verification, {
    status: "not_run",
    summary: "Dry-run failed before agent execution or verification commands ran.",
  });
  assert.equal(failed.errors?.[0]?.code, "DRY_RUN_FAILED");
  assert.equal(failed.errors?.[0]?.retryable, false);

  const blockedRequest = parseRunRequest(
    await readJson("run-request/v1/valid/manual-request.json"),
  );
  const blockedPlan = createRunRequestExecutionPlan(blockedRequest);
  const blocked = createRunResult(blockedPlan, {
    status: "blocked",
    completedAt: "2026-04-30T00:00:06Z",
  });

  assert.equal(validateRunResult(blocked).ok, true);
  assert.equal(blocked.requestId, blockedRequest.id);
  assert.equal(blocked.status, "blocked");
  assert.match(blocked.verification?.summary ?? "", /target is required/);
  assert.deepEqual(blocked.warnings, [
    {
      code: "DRY_RUN_BLOCKED",
      message: "The dry-run request stopped before execution because required planning scope is missing.",
    },
  ]);
});

test("clones caller-provided RunResult verification payloads", async () => {
  const readyRequest = parseRunRequest(
    await readJson("run-request/v1/valid/github-issue-request.json"),
  );
  const readyPlan = createRunRequestExecutionPlan(readyRequest);
  const verification = {
    status: "passed" as const,
    summary: "initial verification summary",
    commands: [
      {
        command: "npm test",
        status: "passed" as const,
        completedAt: "2026-04-30T00:00:04Z",
        summary: "initial command summary",
      },
    ],
  };

  const result = createRunResult(readyPlan, {
    status: "succeeded",
    completedAt: "2026-04-30T00:00:05Z",
    verification,
  });

  verification.summary = "mutated verification summary";
  verification.commands[0].summary = "mutated command summary";

  assert.equal(result.verification?.summary, "initial verification summary");
  assert.equal(result.verification?.commands?.[0]?.summary, "initial command summary");
});

test("rejects non-final RunResult statuses", async () => {
  const invalid = await readJson("run-result/v1/invalid/running-status.json");

  const result = validateRunResult(invalid);

  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => issue.path === "status"),
    "RunResult status must be terminal",
  );
});

test("rejects RunResult timestamps beyond millisecond precision", async () => {
  const readyRequest = parseRunRequest(
    await readJson("run-request/v1/valid/github-issue-request.json"),
  );
  const readyPlan = createRunRequestExecutionPlan(readyRequest);
  const valid = createRunResult(readyPlan, {
    status: "succeeded",
    completedAt: "2026-04-30T00:00:00Z",
  });
  const timestampWithMicroseconds = {
    ...valid,
    completedAt: "2026-04-30T00:00:00.123456Z",
  };

  const result = validateRunResult(timestampWithMicroseconds);

  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.path === "completedAt" &&
        issue.message === "completedAt must be a UTC ISO 8601 timestamp.",
    ),
    "RunResult timestamps must use millisecond precision or less",
  );
});

test("CLI emits terminal RunResult JSON for dry-run RunRequest mode", async () => {
  const fixturePath = path.join(fixtureRoot, "run-request/v1/valid/github-issue-request.json");

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    "dist/src/cli/index.js",
    "run-request",
    fixturePath,
    "--run-result",
    "succeeded",
  ]);

  assert.equal(stderr, "");

  const runResult = JSON.parse(stdout) as unknown;
  const result = validateRunResult(runResult);

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.result.status, "succeeded");
});

test("CLI emits failed RunResult JSON for failed dry-run RunRequest mode", async () => {
  const fixturePath = path.join(fixtureRoot, "run-request/v1/valid/github-issue-request.json");

  await assert.rejects(
    execFileAsync(process.execPath, [
      "dist/src/cli/index.js",
      "run-request",
      fixturePath,
      "--run-result",
      "failed",
    ]),
    (error: unknown) => {
      assert.ok(error && typeof error === "object");
      assert.ok("code" in error);
      assert.equal(error.code, 1);
      assert.ok("stdout" in error && typeof error.stdout === "string");

      const runResult = JSON.parse(error.stdout) as unknown;
      const result = validateRunResult(runResult);

      assert.equal(result.ok, true);
      assert.equal(result.ok && result.result.status, "failed");
      assert.equal(result.ok && result.result.verification?.status, "not_run");
      assert.equal(result.ok && result.result.errors?.[0]?.code, "DRY_RUN_FAILED");

      return true;
    },
  );
});

test("CLI emits blocked RunResult JSON for blocked dry-run plans", async () => {
  const fixturePath = path.join(fixtureRoot, "run-request/v1/valid/manual-request.json");

  await assert.rejects(
    execFileAsync(process.execPath, [
      "dist/src/cli/index.js",
      "run-request",
      fixturePath,
      "--run-result",
      "succeeded",
    ]),
    (error: unknown) => {
      assert.ok(error && typeof error === "object");
      assert.ok("code" in error);
      assert.equal(error.code, 1);
      assert.ok("stdout" in error && typeof error.stdout === "string");

      const runResult = JSON.parse(error.stdout) as unknown;
      const result = validateRunResult(runResult);

      assert.equal(result.ok, true);
      assert.equal(result.ok && result.result.status, "blocked");
      assert.match(result.ok ? (result.result.verification?.summary ?? "") : "", /target is required/);

      return true;
    },
  );
});
