import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createDeterministicLocalFakeExecutor,
  invokeLaneExecutor,
} from "../src/executor/index.js";
import { prepareLocalLaneWorkspace } from "../src/lane/index.js";
import {
  createRunRequestExecutionPlan,
  parseRunRequest,
  validateRunResult,
} from "../src/protocol/index.js";

const request = parseRunRequest({
  schemaVersion: "eip.run-request.v1",
  id: "req_01HV7Y8M8F2KQ5W3P9R6T4N2AA",
  correlationId: "corr_01HV7Y8M8F2KQ5W3P9R6T4N2AB",
  idempotencyKey: "issue-40-test-key-001",
  source: {
    sourceId: "source_01HV7Y8M8F2KQ5W3P9R6T4N2AC",
    sourceType: "github-issue",
  },
  requestedBy: {
    actorId: "actor_01HV7Y8M8F2KQ5W3P9R6T4N2AD",
    actorType: "workflow",
  },
  workItem: {
    workItemId: "workitem_01HV7Y8M8F2KQ5W3P9R6T4N2AE",
    externalId: "40",
    title: "Add deterministic local executor boundary",
  },
  mode: "plan",
  createdAt: "2026-05-01T00:00:00Z",
  target: {
    targetType: "repository",
    targetId: "repo_01HV7Y8M8F2KQ5W3P9R6T4N2AF",
  },
  policyContext: {
    policySetId: "policy_01HV7Y8M8F2KQ5W3P9R6T4N2AG",
    riskClasses: [],
    requiresApproval: false,
  },
});

async function withPreparedLane(
  callback: (preparedContext: {
    readonly laneRunId: string;
    readonly workspacePath: string;
    readonly statePath: string;
  }) => Promise<void>,
): Promise<void> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-workspace-"));
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    const laneRunId = "run_01HV7Y8M8F2KQ5W3P9R6T4N2AA";
    const prepared = await prepareLocalLaneWorkspace({
      workspaceRoot,
      stateRoot,
      laneRunId,
      workItemId: request.workItem.workItemId,
    });

    await callback({
      laneRunId,
      workspacePath: prepared.workspacePath,
      statePath: prepared.statePath,
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
}

test("invokes the deterministic local fake executor through the provider boundary", async () => {
  await withPreparedLane(async (preparedContext) => {
    const result = await invokeLaneExecutor({
      executor: createDeterministicLocalFakeExecutor(),
      mode: "deterministic-local-fake",
      plan: createRunRequestExecutionPlan(request),
      preparedContext,
      completedAt: "2026-05-01T00:00:01Z",
      fixture: {
        name: "issue-40-succeeded",
        outcome: "succeeded",
        verificationSummary: "sanitized fake executor success",
      },
    });

    assert.equal(result.status, "succeeded");
    assert.equal(validateRunResult(result.runResult).ok, true);
    assert.equal(result.runResult.status, "succeeded");
    assert.deepEqual(result.invocation, {
      executorId: "deterministic-local-fake",
      mode: "deterministic-local-fake",
      laneRunId: preparedContext.laneRunId,
      requestId: request.id,
      workItemId: request.workItem.workItemId,
      fixtureName: "issue-40-succeeded",
      invokedAt: "2026-05-01T00:00:01Z",
      invokesProvider: false,
      mutatesScm: false,
    });
    assert.doesNotMatch(JSON.stringify(result), new RegExp(os.tmpdir()));
  });
});

test("emits deterministic failed and blocked fake executor outcomes", async () => {
  await withPreparedLane(async (preparedContext) => {
    const failed = await invokeLaneExecutor({
      executor: createDeterministicLocalFakeExecutor(),
      mode: "deterministic-local-fake",
      plan: createRunRequestExecutionPlan(request),
      preparedContext,
      completedAt: "2026-05-01T00:00:02Z",
      fixture: {
        name: "issue-40-failed",
        outcome: "failed",
        verificationSummary: "sanitized fake executor failure",
      },
    });
    const blocked = await invokeLaneExecutor({
      executor: createDeterministicLocalFakeExecutor(),
      mode: "deterministic-local-fake",
      plan: createRunRequestExecutionPlan(request),
      preparedContext,
      completedAt: "2026-05-01T00:00:03Z",
      fixture: {
        name: "issue-40-blocked",
        outcome: "blocked",
        blockedReasons: ["missing prepared verification evidence"],
      },
    });

    assert.equal(failed.status, "failed");
    assert.equal(failed.runResult.status, "failed");
    assert.equal(failed.runResult.verification?.status, "failed");
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.runResult.status, "blocked");
    assert.deepEqual(blocked.blockedReasons, ["missing prepared verification evidence"]);
  });
});

test("fails closed for unsupported executor modes before invoking an adapter", async () => {
  await withPreparedLane(async (preparedContext) => {
    let invoked = false;
    const result = await invokeLaneExecutor({
      executor: {
        id: "not-supported",
        async invoke() {
          invoked = true;
          throw new Error("unexpected invocation");
        },
      },
      mode: "remote-provider",
      plan: createRunRequestExecutionPlan(request),
      preparedContext,
      completedAt: "2026-05-01T00:00:04Z",
      fixture: {
        name: "issue-40-unsupported",
        outcome: "succeeded",
      },
    });

    assert.equal(invoked, false);
    assert.equal(result.status, "blocked");
    assert.match(result.blockedReasons.join("\n"), /Unsupported executor mode/);
  });
});

test("blocks unsafe fake fixture metadata without echoing raw secret or workstation paths", async () => {
  await withPreparedLane(async (preparedContext) => {
    const result = await invokeLaneExecutor({
      executor: createDeterministicLocalFakeExecutor(),
      mode: "deterministic-local-fake",
      plan: createRunRequestExecutionPlan(request),
      preparedContext,
      completedAt: "2026-05-01T00:00:05Z",
      fixture: {
        name: "issue-40-unsafe",
        outcome: "succeeded",
        verificationSummary: "token=raw-test-token at /Users/example/project",
      },
    });
    const serialized = JSON.stringify(result);

    assert.equal(result.status, "blocked");
    assert.match(result.blockedReasons.join("\n"), /unsafe metadata/);
    assert.doesNotMatch(serialized, /raw-test-token/);
    assert.doesNotMatch(serialized, /\/Users\/example/);
  });
});

test("fails closed when prepared lane context is missing or unprepared", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    const missing = await invokeLaneExecutor({
      executor: createDeterministicLocalFakeExecutor(),
      mode: "deterministic-local-fake",
      plan: createRunRequestExecutionPlan(request),
      completedAt: "2026-05-01T00:00:06Z",
      fixture: {
        name: "issue-40-missing-context",
        outcome: "succeeded",
      },
    });

    assert.equal(missing.status, "blocked");
    assert.match(missing.blockedReasons.join("\n"), /Prepared lane context is required/);

    const unpreparedWorkspacePath = path.join(os.tmpdir(), `ensen-loop-unprepared-${process.pid}`);
    const unprepared = await invokeLaneExecutor({
      executor: createDeterministicLocalFakeExecutor(),
      mode: "deterministic-local-fake",
      plan: createRunRequestExecutionPlan(request),
      preparedContext: {
        laneRunId: "run_01HV7Y8M8F2KQ5W3P9R6T4N2AA",
        workspacePath: unpreparedWorkspacePath,
        statePath: stateRoot,
      },
      completedAt: "2026-05-01T00:00:07Z",
      fixture: {
        name: "issue-40-unprepared-context",
        outcome: "succeeded",
      },
    });

    assert.equal(unprepared.status, "blocked");
    assert.match(unprepared.blockedReasons.join("\n"), /Prepared lane workspace path must exist/);
    await assert.rejects(() => mkdir(path.join(unpreparedWorkspacePath, "should-not-exist")), /ENOENT/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
