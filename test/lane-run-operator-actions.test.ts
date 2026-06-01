import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
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
  getLaneRunStatus,
  readLaneRunLock,
  readLaneRunQueueRecord,
  requeueLaneRun,
  resolveLaneRunLockPath,
  resolveLaneRunQueueRecordPath,
  retryLaneRun,
  stopLaneRun,
  writeLaneRunState,
} from "../src/lane/index.js";

const execFileAsync = promisify(execFile);
const queuedAt = new Date(Date.now() - 120_000).toISOString();
const claimedAt = new Date(Date.now() - 60_000).toISOString();
const actedAt = new Date(Date.now() - 1_000).toISOString();

function laneRunIdDigest(laneRunId: string): string {
  return createHash("sha256").update(laneRunId).digest("hex");
}

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
        blockerReason: "stale blocker carried by queued record",
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
    assert.equal(Object.hasOwn(queue.metadata, "blockerReason"), false);
    assert.equal((await getLaneRunStatus(stateRoot)).queue[0]?.laneState, "revoked");
  });
});

test("stop stores a bounded public reason in queue metadata", async () => {
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

    const longReason = `operator reason ${"x".repeat(300)}`;
    const result = await stopLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      reason: longReason,
      actedAt,
    });

    assert.equal(result.ok, true);

    const queue = await readLaneRunQueueRecord(stateRoot, "github-issue-112");
    assert.equal(queue.metadata.operatorReason.length, 256);
    assert.equal(queue.metadata.operatorReason.endsWith("..."), true);
  });
});

test("stop revokes a long-running active lane run", async () => {
  await withStateRoot(async (stateRoot) => {
    const staleQueuedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const staleClaimedAt = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString();

    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      workItemId: "issue-112",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt: staleQueuedAt,
    });
    await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      claimedBy: "local-supervisor",
      claimedAt: staleClaimedAt,
    });

    const result = await stopLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      reason: "operator revokes stale active lane run",
      actedAt,
    });

    assert.equal(result.ok, true);

    const lock = await readLaneRunLock(stateRoot, "github-issue-112");
    const queue = await readLaneRunQueueRecord(stateRoot, "github-issue-112");

    assert.equal(lock.status, "revoked");
    assert.equal(lock.releasedAt, actedAt);
    assert.equal(queue.status, "revoked");
    assert.equal(queue.metadata.revokedLaneRunId, "lane-run-112-a");
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

test("stop fails closed when the active lock no longer points at the queue record", async () => {
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
    const driftedQueue = {
      ...queued,
      id: "queue-github-issue-112-2",
      enqueueSequence: 2,
      updatedAt: actedAt,
    };
    await writeFile(
      resolveLaneRunQueueRecordPath(stateRoot, "github-issue-112"),
      `${JSON.stringify(driftedQueue, null, 2)}\n`,
      "utf8",
    );

    const result = await stopLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      reason: "operator stop",
      actedAt,
    });

    assert.equal(result.ok, false);
    assert.equal(result.publicDiagnostics.reason, "lane run queue record does not match the active lane run lock");
    assert.deepEqual(await readLaneRunQueueRecord(stateRoot, "github-issue-112"), driftedQueue);
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

test("stop rejects blocked lineage from a lane run owned by another work item", async () => {
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
    await writeLaneRunState(
      stateRoot,
      createLaneRunState({
        id: "lane-run-112-a",
        workItemId: "issue-999",
        status: "blocked",
        revision: 1,
        createdAt: claimedAt,
        updatedAt: actedAt,
        journal: createLaneJournal({
          id: "journal-lane-run-112-a",
          laneRunId: "lane-run-112-a",
          workItemId: "issue-999",
        }),
        evidence: {
          bundleRefs: ["artifacts/evidence/unrelated.json"],
        },
      }),
    );

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
    assert.equal(
      (await readLaneRunQueueRecord(stateRoot, "github-issue-112")).metadata.supersededLaneRunId,
      "lane-run-112-a",
    );
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
    const longReason = `retry after focused fix ${"x".repeat(300)}`;
    const result = await retryLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      reason: longReason,
      actedAt,
    });

    if (!result.ok) {
      assert.fail("retry should create a linked queued attempt");
    }

    if (result.queueRecord === undefined) {
      assert.fail("retry should return the new queue record");
    }

    assert.equal(result.action, "retry");
    assert.equal(result.queueRecord.id, "queue-github-issue-112-2");
    assert.equal(result.lineage.relationship, "retried");
    assert.deepEqual(result.lineage.preservedEvidenceRefs, ["artifacts/evidence/lane-run-112-a.json"]);

    const queue = await readLaneRunQueueRecord(stateRoot, "github-issue-112");
    assert.equal(queue.status, "queued");
    assert.equal(queue.enqueueSequence, 2);
    assert.equal(queue.metadata.retryOfLaneRunId, "lane-run-112-a");
    assert.equal(queue.metadata.previousQueueRecordId, "queue-github-issue-112-1");
    assert.equal(queue.metadata.operatorReason.length, 256);
    assert.equal(queue.metadata.operatorReason.endsWith("..."), true);
    assert.equal(queue.metadata.preservedEvidenceRefCount, "1");
    assert.equal(Object.hasOwn(queue.metadata, "preservedEvidenceRefs"), false);
    assert.equal(await readFile(path.join(stateRoot, "lane-runs", "lane-run-112-a.json"), "utf8"), originalState);
  });
});

test("retry drops stale preserved evidence metadata when the next target has no evidence", async () => {
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
        preservedEvidenceRefCount: "9",
      },
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
      }),
    );

    const result = await retryLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      reason: "retry after focused fix",
      actedAt,
    });

    assert.equal(result.ok, true);

    const queue = await readLaneRunQueueRecord(stateRoot, "github-issue-112");
    assert.equal(queue.metadata.issueNumber, "112");
    assert.equal(queue.metadata.retryOfLaneRunId, "lane-run-112-a");
    assert.equal(Object.hasOwn(queue.metadata, "preservedEvidenceRefCount"), false);
  });
});

test("retry fails closed when a retry attempt is already queued", async () => {
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
      }),
    );

    const firstRetry = await retryLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      reason: "operator retry",
      actedAt,
    });

    assert.equal(firstRetry.ok, true);

    const queuedRetry = await readLaneRunQueueRecord(stateRoot, "github-issue-112");
    const terminalLock = await readLaneRunLock(stateRoot, "github-issue-112");
    const secondRetry = await retryLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      reason: "operator retry again",
      actedAt,
    });

    assert.equal(secondRetry.ok, false);
    assert.equal(secondRetry.publicDiagnostics.reason, "operator action requires a terminal lane run record");
    assert.deepEqual(await readLaneRunQueueRecord(stateRoot, "github-issue-112"), queuedRetry);
    assert.deepEqual(await readLaneRunLock(stateRoot, "github-issue-112"), terminalLock);
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

test("requeue writes bounded operator metadata and drops stale blocker lineage", async () => {
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

    const revokedQueue = await readLaneRunQueueRecord(stateRoot, "github-issue-112");
    await writeFile(
      resolveLaneRunQueueRecordPath(stateRoot, "github-issue-112"),
      `${JSON.stringify(
        {
          ...revokedQueue,
          metadata: {
            ...revokedQueue.metadata,
            blockerReason: "stale blocked projection",
            preservedEvidenceRefCount: "7",
            preservedEvidenceRefs: "artifacts/evidence/stale.json",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await requeueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      reason: `operator requeue ${"x".repeat(300)}`,
      actedAt,
    });

    assert.equal(result.ok, true);

    const queue = await readLaneRunQueueRecord(stateRoot, "github-issue-112");
    assert.equal(queue.status, "queued");
    assert.equal(queue.metadata.operatorReason.length, 256);
    assert.equal(queue.metadata.operatorReason.endsWith("..."), true);
    assert.equal(Object.hasOwn(queue.metadata, "blockerReason"), false);
    assert.equal(Object.hasOwn(queue.metadata, "preservedEvidenceRefCount"), false);
    assert.equal(Object.hasOwn(queue.metadata, "preservedEvidenceRefs"), false);
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
    const status = await getLaneRunStatus(stateRoot);

    assert.equal(Object.hasOwn(revokedQueue.metadata, "blockerReason"), false);
    assert.equal(status.queue[0]?.laneState, "revoked");

    const result = await requeueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-b",
      reason: "operator requeue wrong target",
      actedAt,
    });

    assert.equal(result.ok, false);
    assert.equal(result.publicDiagnostics.reason, "operator action target requires verified terminal lane run state");
    assert.deepEqual(await readLaneRunQueueRecord(stateRoot, "github-issue-112"), revokedQueue);
  });
});

test("requeue without a lock rejects same-work-item lane state not linked by the terminal queue record", async () => {
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
      reason: "operator stop before lockless requeue",
      actedAt,
    });
    await writeLaneRunState(
      stateRoot,
      createLaneRunState({
        id: "lane-run-112-b",
        workItemId: "issue-112",
        status: "failed",
        revision: 1,
        createdAt: claimedAt,
        updatedAt: actedAt,
        journal: createLaneJournal({
          id: "journal-lane-run-112-b",
          laneRunId: "lane-run-112-b",
          workItemId: "issue-112",
        }),
        evidence: {
          bundleRefs: ["artifacts/evidence/unlinked-lane-run.json"],
        },
      }),
    );
    await rm(resolveLaneRunLockPath(stateRoot, "github-issue-112"), { force: true });
    const revokedQueue = await readLaneRunQueueRecord(stateRoot, "github-issue-112");

    const result = await requeueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-b",
      reason: "operator requeue unlinked lane state",
      actedAt,
    });

    assert.equal(result.ok, false);
    assert.equal(result.publicDiagnostics.reason, "operator action target requires verified terminal lane run state");
    assert.deepEqual(await readLaneRunQueueRecord(stateRoot, "github-issue-112"), revokedQueue);
  });
});

test("requeue without a lock rejects superseded records without explicit lane run ownership", async () => {
  await withStateRoot(async (stateRoot) => {
    const queued = await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      workItemId: "issue-112",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });
    const supersededQueue = {
      ...queued,
      status: "superseded" as const,
      updatedAt: actedAt,
      publicDiagnostics: {
        ...queued.publicDiagnostics,
        status: "superseded" as const,
      },
    };
    await writeFile(
      resolveLaneRunQueueRecordPath(stateRoot, "github-issue-112"),
      `${JSON.stringify(supersededQueue, null, 2)}\n`,
      "utf8",
    );
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
      }),
    );

    const result = await requeueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      reason: "operator requeue superseded record",
      actedAt,
    });

    assert.equal(result.ok, false);
    assert.equal(result.publicDiagnostics.reason, "operator action target requires verified terminal lane run state");
    assert.deepEqual(await readLaneRunQueueRecord(stateRoot, "github-issue-112"), supersededQueue);
  });
});

test("requeue without a lock accepts verified superseded queue records", async () => {
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
      }),
    );
    await rm(resolveLaneRunLockPath(stateRoot, "github-issue-112"), { force: true });

    const result = await requeueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      reason: "operator requeue superseded record",
      actedAt,
    });

    assert.equal(result.ok, true);
    assert.equal(result.publicDiagnostics.lockStatus, "superseded");

    const queue = await readLaneRunQueueRecord(stateRoot, "github-issue-112");
    assert.equal(queue.status, "queued");
    assert.equal(queue.metadata.previousQueueStatus, "superseded");
    assert.equal(queue.metadata.requeueOfLaneRunId, "lane-run-112-a");
  });
});

test("requeue without a lock verifies terminal lineage by digest when metadata id is bounded", async () => {
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
      }),
    );
    await rm(resolveLaneRunLockPath(stateRoot, "github-issue-112"), { force: true });

    const supersededQueue = await readLaneRunQueueRecord(stateRoot, "github-issue-112");
    await writeFile(
      resolveLaneRunQueueRecordPath(stateRoot, "github-issue-112"),
      `${JSON.stringify(
        {
          ...supersededQueue,
          metadata: {
            ...supersededQueue.metadata,
            supersededLaneRunId: "bounded-lane-run-id-projection",
            supersededLaneRunIdSha256: laneRunIdDigest("lane-run-112-a"),
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await requeueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      reason: "operator requeue superseded record",
      actedAt,
    });

    assert.equal(result.ok, true);
    assert.equal(result.lineage.previousLaneRunId, "lane-run-112-a");

    const queue = await readLaneRunQueueRecord(stateRoot, "github-issue-112");
    assert.equal(queue.status, "queued");
    assert.equal(queue.metadata.previousQueueStatus, "superseded");
    assert.equal(queue.metadata.requeueOfLaneRunId, "lane-run-112-a");
    assert.equal(queue.metadata.requeueOfLaneRunIdSha256, laneRunIdDigest("lane-run-112-a"));
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

test("CLI retry does not print queued metadata values", async () => {
  await withStateRoot(async (stateRoot) => {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      workItemId: "issue-112",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
      metadata: {
        privateOperatorNote: "token=ghp_sampleSecretValue",
      },
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
      }),
    );

    const result = await execCli([
      "retry",
      "--state-root",
      stateRoot,
      "--issue",
      "github-issue-112",
      "--lane-run",
      "lane-run-112-a",
      "--reason",
      "operator token=ghp_sampleSecretValue retry",
    ]);
    const output = JSON.parse(result.stdout) as {
      readonly ok?: unknown;
      readonly action?: unknown;
      readonly publicDiagnostics?: { readonly reason?: unknown };
    };
    const serializedOutput = JSON.stringify(output);

    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(output.ok, true);
    assert.equal(output.action, "retry");
    assert.equal(output.publicDiagnostics?.reason, "operator <redacted> retry");
    assert.equal(serializedOutput.includes(stateRoot), false);
    assert.equal(serializedOutput.includes("ghp_sampleSecretValue"), false);
    assert.equal(serializedOutput.includes("queueRecord"), false);
    assert.equal(serializedOutput.includes("metadata"), false);
    assert.equal(serializedOutput.includes("privateOperatorNote"), false);
  });
});

test("CLI stop and requeue smoke preserves lineage without printing durable metadata", async () => {
  await withStateRoot(async (stateRoot) => {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      workItemId: "issue-112",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
      metadata: {
        privateOperatorNote: "token=ghp_sampleSecretValue",
      },
    });
    await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      laneRunId: "lane-run-112-a",
      claimedBy: "local-supervisor",
      claimedAt,
    });

    const stopResult = await execCli([
      "stop",
      "--state-root",
      stateRoot,
      "--issue",
      "github-issue-112",
      "--lane-run",
      "lane-run-112-a",
      "--reason",
      "operator stops before requeue",
    ]);
    assert.equal(stopResult.exitCode, 0);

    const requeueResult = await execCli([
      "requeue",
      "--state-root",
      stateRoot,
      "--issue",
      "github-issue-112",
      "--lane-run",
      "lane-run-112-a",
      "--reason",
      "operator token=ghp_sampleSecretValue requeue",
    ]);
    const output = JSON.parse(requeueResult.stdout) as {
      readonly ok?: unknown;
      readonly action?: unknown;
      readonly publicDiagnostics?: { readonly reason?: unknown };
      readonly lineage?: { readonly relationship?: unknown; readonly previousLaneRunId?: unknown; readonly newQueueRecordId?: unknown };
    };
    const serializedOutput = JSON.stringify(output);

    assert.equal(requeueResult.stderr, "");
    assert.equal(requeueResult.exitCode, 0);
    assert.equal(output.ok, true);
    assert.equal(output.action, "requeue");
    assert.equal(output.publicDiagnostics?.reason, "operator <redacted> requeue");
    assert.deepEqual(output.lineage, {
      relationship: "requeued",
      previousLaneRunId: "lane-run-112-a",
      newQueueRecordId: "queue-github-issue-112-2",
      preservedEvidenceRefCount: 0,
    });
    assert.equal(serializedOutput.includes(stateRoot), false);
    assert.equal(serializedOutput.includes("ghp_sampleSecretValue"), false);
    assert.equal(serializedOutput.includes("queueRecord"), false);
    assert.equal(serializedOutput.includes("metadata"), false);
    assert.equal(serializedOutput.includes("privateOperatorNote"), false);
  });
});
