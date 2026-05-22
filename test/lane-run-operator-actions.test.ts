import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  claimQueuedLaneRun,
  completeLaneRunLock,
  createLaneJournal,
  createLaneRunState,
  enqueueLaneRun,
  readLaneRunLock,
  readLaneRunQueueRecord,
  requeueLaneRun,
  retryLaneRun,
  stopLaneRun,
  writeLaneRunState,
} from "../src/lane/index.js";

const execFileAsync = promisify(execFile);
const queuedAt = new Date(Date.now() - 120_000).toISOString();
const claimedAt = new Date(Date.now() - 60_000).toISOString();
const actedAt = new Date(Date.now() - 1_000).toISOString();

async function withStateRoot(callback: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    await mkdir(path.join(stateRoot, "lane-runs"), { recursive: true });
    await callback(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

async function execCli(args: readonly string[]): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }> {
  try {
    const result = await execFileAsync(process.execPath, ["dist/src/cli/index.js", ...args]);

    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    if (
      error instanceof Error &&
      typeof (error as { readonly code?: unknown }).code === "number" &&
      typeof (error as { readonly stdout?: unknown }).stdout === "string" &&
      typeof (error as { readonly stderr?: unknown }).stderr === "string"
    ) {
      const cliError = error as Error & { readonly code: number; readonly stdout: string; readonly stderr: string };

      return {
        stdout: cliError.stdout,
        stderr: cliError.stderr,
        exitCode: cliError.code,
      };
    }

    throw error;
  }
}

test("stop revokes an active lane run with a public operator reason", async () => {
  await withStateRoot(async (stateRoot) => {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      workItemId: "issue-112",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
      metadata: {
        issueNumber: "112",
      },
    });
    await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      claimedBy: "local-supervisor",
      claimedAt,
    });

    const result = await stopLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      reason: "operator found missing evidence token=ghp_sampleSecretValue",
      actedAt,
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "stop");
    assert.equal(result.publicDiagnostics.reason, "operator found missing evidence <redacted>");
    assert.equal(result.lineage.relationship, "revoked");

    const lock = await readLaneRunLock(stateRoot, "github-issue-112");
    const queue = await readLaneRunQueueRecord(stateRoot, "github-issue-112");

    assert.equal(lock.status, "revoked");
    assert.equal(lock.active, false);
    assert.equal(lock.releasedAt, actedAt);
    assert.equal(queue.status, "revoked");
    assert.equal(queue.metadata.revokedByOperatorAt, actedAt);
    assert.equal(queue.metadata.operatorReason, "operator found missing evidence <redacted>");
  });
});

test("stop reads active lineage evidence before mutating durable state", async () => {
  await withStateRoot(async (stateRoot) => {
    const queued = await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      workItemId: "issue-112",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });
    const claim = await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      claimedBy: "local-supervisor",
      claimedAt,
    });
    await writeFile(path.join(stateRoot, "lane-runs", "lane-run-112-a.json"), "{}\n", "utf8");

    await assert.rejects(
      () =>
        stopLaneRun(stateRoot, {
          stableWorkItemId: "github-issue-112",
          laneRunId: "lane-run-112-a",
          reason: "operator stop",
          actedAt,
        }),
      /Lane run state/,
    );

    assert.deepEqual(await readLaneRunQueueRecord(stateRoot, "github-issue-112"), queued);
    assert.deepEqual(await readLaneRunLock(stateRoot, "github-issue-112"), claim.lock);
  });
});

test("stop fails closed for a blocked queue item without verified lane state", async () => {
  await withStateRoot(async (stateRoot) => {
    const queued = await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      workItemId: "issue-112",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
      metadata: {
        blockerReason: "waiting for operator review",
      },
    });

    const result = await stopLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      reason: "operator stop",
      actedAt,
    });

    assert.equal(result.ok, false);
    assert.equal(result.publicDiagnostics.reason, "operator action target requires verified blocked lane run state");
    assert.deepEqual(await readLaneRunQueueRecord(stateRoot, "github-issue-112"), queued);
  });
});

test("retry links a new queued attempt to prior evidence without deleting lane state", async () => {
  await withStateRoot(async (stateRoot) => {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      workItemId: "issue-112",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });
    await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      claimedBy: "local-supervisor",
      claimedAt,
    });
    await completeLaneRunLock(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      completedAt: actedAt,
      terminalStatus: "superseded",
    });
    await writeLaneRunState(
      stateRoot,
      createLaneRunState({
        id: "lane-run-112-a",
        workItemId: "issue-112",
        status: "failed",
        revision: 1,
        createdAt: claimedAt,
        updatedAt: actedAt,
        journal: createLaneJournal({
          id: "journal-lane-run-112-a",
          laneRunId: "lane-run-112-a",
          workItemId: "issue-112",
        }),
        evidence: {
          bundleRefs: ["artifacts/evidence/lane-run-112-a.json"],
        },
      }),
    );

    const originalState = await readFile(path.join(stateRoot, "lane-runs", "lane-run-112-a.json"), "utf8");
    const result = await retryLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      reason: "retry after focused fix",
      actedAt,
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "retry");
    assert.equal(result.queueRecord?.id, "queue-github-issue-112-2");
    assert.equal(result.lineage.relationship, "retried");
    assert.deepEqual(result.lineage.preservedEvidenceRefs, ["artifacts/evidence/lane-run-112-a.json"]);

    const queue = await readLaneRunQueueRecord(stateRoot, "github-issue-112");
    assert.equal(queue.status, "queued");
    assert.equal(queue.enqueueSequence, 2);
    assert.equal(queue.metadata.retryOfLaneRunId, "lane-run-112-a");
    assert.equal(queue.metadata.previousQueueRecordId, "queue-github-issue-112-1");
    assert.equal(queue.metadata.preservedEvidenceRefCount, "1");
    assert.equal(Object.hasOwn(queue.metadata, "preservedEvidenceRefs"), false);
    assert.equal(await readFile(path.join(stateRoot, "lane-runs", "lane-run-112-a.json"), "utf8"), originalState);
  });
});

test("retry fails closed for an active lane run and keeps durable state unchanged", async () => {
  await withStateRoot(async (stateRoot) => {
    const queued = await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      workItemId: "issue-112",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });
    const claim = await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      claimedBy: "local-supervisor",
      claimedAt,
    });

    const result = await retryLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      reason: "operator retry",
      actedAt,
    });

    assert.equal(result.ok, false);
    assert.equal(result.publicDiagnostics.reason, "cannot retry an active lane run; stop it first");
    assert.deepEqual(await readLaneRunQueueRecord(stateRoot, "github-issue-112"), queued);
    assert.deepEqual(await readLaneRunLock(stateRoot, "github-issue-112"), claim.lock);
  });
});

test("requeue returns a revoked work item to the queue with lineage", async () => {
  await withStateRoot(async (stateRoot) => {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      workItemId: "issue-112",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });
    await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      claimedBy: "local-supervisor",
      claimedAt,
    });
    await stopLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      reason: "operator stop before requeue",
      actedAt,
    });

    const result = await requeueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      reason: "operator requeue",
      actedAt,
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "requeue");
    assert.equal(result.lineage.relationship, "requeued");

    const queue = await readLaneRunQueueRecord(stateRoot, "github-issue-112");
    assert.equal(queue.status, "queued");
    assert.equal(queue.enqueueSequence, 2);
    assert.equal(queue.metadata.requeueOfLaneRunId, "lane-run-112-a");
    assert.equal(queue.metadata.previousQueueStatus, "revoked");
  });
});

test("requeue without a lock requires verified revoked lane state ownership", async () => {
  await withStateRoot(async (stateRoot) => {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      workItemId: "issue-112",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
      metadata: {
        blockerReason: "waiting for operator review",
      },
    });
    await writeLaneRunState(
      stateRoot,
      createLaneRunState({
        id: "lane-run-112-a",
        workItemId: "issue-112",
        status: "blocked",
        revision: 1,
        createdAt: claimedAt,
        updatedAt: actedAt,
        journal: createLaneJournal({
          id: "journal-lane-run-112-a",
          laneRunId: "lane-run-112-a",
          workItemId: "issue-112",
        }),
      }),
    );
    const stopped = await stopLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      reason: "operator stop blocked item",
      actedAt,
    });
    assert.equal(stopped.ok, true);
    const revokedQueue = await readLaneRunQueueRecord(stateRoot, "github-issue-112");

    const result = await requeueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-b",
      reason: "operator requeue wrong target",
      actedAt,
    });

    assert.equal(result.ok, false);
    assert.equal(result.publicDiagnostics.reason, "operator action target requires verified revoked lane run state");
    assert.deepEqual(await readLaneRunQueueRecord(stateRoot, "github-issue-112"), revokedQueue);
  });
});

test("CLI stop emits public-safe action diagnostics", async () => {
  await withStateRoot(async (stateRoot) => {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      workItemId: "issue-112",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });
    await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      claimedBy: "local-supervisor",
      claimedAt,
    });

    const result = await execCli([
      "stop",
      "--state-root",
      stateRoot,
      "--issue",
      "github-issue-112",
      "--lane-run",
      "lane-run-112-a",
      "--reason",
      "operator token=ghp_sampleSecretValue stop",
    ]);
    const output = JSON.parse(result.stdout) as {
      readonly ok?: unknown;
      readonly action?: unknown;
      readonly publicDiagnostics?: { readonly reason?: unknown };
    };

    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(output.ok, true);
    assert.equal(output.action, "stop");
    assert.equal(output.publicDiagnostics?.reason, "operator <redacted> stop");
    assert.equal(JSON.stringify(output).includes(stateRoot), false);
    assert.equal(JSON.stringify(output).includes("ghp_sampleSecretValue"), false);
    assert.equal(JSON.stringify(output).includes("queueRecord"), false);
    assert.equal(JSON.stringify(output).includes("metadata"), false);
  });
});
