import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import {
  claimQueuedLaneRun,
  completeLaneRunLock,
  enqueueLaneRun,
  readLaneRunLock,
  readLaneRunQueueRecord,
  resolveLaneRunLockPath,
  resolveLaneRunQueueRecordPath,
} from "../src/lane/index.js";

const queuedAt = "2026-05-21T05:00:00.000Z";
const claimedAt = "2026-05-21T05:01:00.000Z";
const completedAt = "2026-05-21T05:02:00.000Z";

test("queues an issue work item and claims it exactly once while the lock is active", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    const queued = await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
      metadata: {
        issueNumber: "110",
      },
    });

    assert.equal(queued.status, "queued");
    assert.equal(queued.id, "queue-github-issue-110-1");
    assert.equal(queued.enqueueSequence, 1);
    assert.equal(queued.startsAgentExecution, false);
    assert.deepEqual(queued.publicDiagnostics, {
      stableWorkItemId: "github-issue-110",
      laneId: "owner-dogfood",
      source: "github-issue",
      repositoryClassification: "owner-controlled-dogfood",
      status: "queued",
    });

    const claim = await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: "lane-run-110-a",
      claimedBy: "local-supervisor",
      claimedAt,
    });

    assert.equal(claim.ok, true);
    assert.equal(claim.lock.status, "active");
    assert.equal(claim.lock.queueRecordId, queued.id);
    assert.equal(claim.lock.startsAgentExecution, false);
    assert.deepEqual(claim.publicDiagnostics, {
      stableWorkItemId: "github-issue-110",
      laneId: "owner-dogfood",
      source: "github-issue",
      repositoryClassification: "owner-controlled-dogfood",
      lockStatus: "active",
      laneRunId: "lane-run-110-a",
      reason: "claimed",
    });

    const duplicate = await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: "lane-run-110-b",
      claimedBy: "local-supervisor",
      claimedAt: "2026-05-21T05:01:30.000Z",
    });

    assert.equal(duplicate.ok, false);
    assert.match(duplicate.reason, /already claimed by active lane run lane-run-110-a/);
    assert.deepEqual(duplicate.publicDiagnostics, {
      stableWorkItemId: "github-issue-110",
      laneId: "owner-dogfood",
      source: "github-issue",
      repositoryClassification: "owner-controlled-dogfood",
      lockStatus: "active",
      laneRunId: "lane-run-110-a",
      reason: "already claimed by active lane run lane-run-110-a",
    });
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("serializes concurrent claims so only one active lock is created", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });

    const claims = await Promise.all([
      claimQueuedLaneRun(stateRoot, {
        stableWorkItemId: "github-issue-110",
        laneRunId: "lane-run-110-a",
        claimedBy: "local-supervisor",
        claimedAt,
      }),
      claimQueuedLaneRun(stateRoot, {
        stableWorkItemId: "github-issue-110",
        laneRunId: "lane-run-110-b",
        claimedBy: "local-supervisor",
        claimedAt: "2026-05-21T05:01:01.000Z",
      }),
    ]);

    const successfulClaims = claims.filter((claim) => claim.ok);
    const rejectedClaims = claims.filter((claim) => !claim.ok);

    assert.equal(successfulClaims.length, 1);
    assert.equal(rejectedClaims.length, 1);
    assert.match(rejectedClaims[0].reason, /already claimed by active lane run lane-run-110-[ab]/);

    const durableLock = await readLaneRunLock(stateRoot, "github-issue-110");
    assert.equal(durableLock.status, "active");
    assert.equal(durableLock.laneRunId, successfulClaims[0].lock.laneRunId);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("rejects enqueue while an active lock exists for the same work item", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110-a",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });

    const claim = await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: "lane-run-110-a",
      claimedBy: "local-supervisor",
      claimedAt,
    });
    assert.equal(claim.ok, true);

    await assert.rejects(
      () =>
        enqueueLaneRun(stateRoot, {
          stableWorkItemId: "github-issue-110",
          workItemId: "issue-110-b",
          source: "github-issue",
          laneId: "owner-dogfood",
          repositoryClassification: "owner-controlled-dogfood",
          queuedAt: "2026-05-21T05:01:30.000Z",
        }),
      /already claimed by active lane run lane-run-110-a/,
    );

    const durableQueueRecord = await readLaneRunQueueRecord(stateRoot, "github-issue-110");
    assert.equal(durableQueueRecord.workItemId, "issue-110-a");
    assert.equal(durableQueueRecord.status, "queued");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("distinguishes completed locks from active locks and allows a later claim", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });

    const firstClaim = await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: "lane-run-110-a",
      claimedBy: "local-supervisor",
      claimedAt,
    });
    await completeLaneRunLock(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: firstClaim.lock.laneRunId,
      completedAt,
      terminalStatus: "completed",
    });

    const completed = await readLaneRunLock(stateRoot, "github-issue-110");
    assert.equal(completed.status, "completed");
    assert.equal(completed.active, false);

    const rediscovered = await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt: "2026-05-21T05:02:30.000Z",
    });
    assert.equal(rediscovered.status, "queued");
    assert.equal(rediscovered.id, "queue-github-issue-110-2");
    assert.equal(rediscovered.enqueueSequence, 2);

    const secondClaim = await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: "lane-run-110-b",
      claimedBy: "local-supervisor",
      claimedAt: "2026-05-21T05:03:00.000Z",
    });

    assert.equal(secondClaim.ok, true);
    assert.equal(secondClaim.lock.status, "active");
    assert.equal(secondClaim.lock.laneRunId, "lane-run-110-b");
    assert.equal(secondClaim.lock.queueRecordId, rediscovered.id);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("uses internal enqueue sequence instead of source timestamps for stale terminal locks", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });

    const firstClaim = await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: "lane-run-110-a",
      claimedBy: "local-supervisor",
      claimedAt,
    });
    await completeLaneRunLock(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: firstClaim.lock.laneRunId,
      completedAt,
      terminalStatus: "completed",
    });

    const rediscovered = await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt: "2026-05-21T04:59:00.000Z",
    });
    const secondClaim = await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: "lane-run-110-b",
      claimedBy: "local-supervisor",
      claimedAt: "2026-05-21T05:03:00.000Z",
    });

    assert.equal(rediscovered.enqueueSequence, 2);
    assert.equal(secondClaim.ok, true);
    assert.equal(secondClaim.lock.queueRecordId, rediscovered.id);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("rejects attempts to rewrite a terminal lock", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });

    const claim = await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: "lane-run-110-a",
      claimedBy: "local-supervisor",
      claimedAt,
    });
    await completeLaneRunLock(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: claim.lock.laneRunId,
      completedAt,
      terminalStatus: "completed",
    });

    await assert.rejects(
      () =>
        completeLaneRunLock(stateRoot, {
          stableWorkItemId: "github-issue-110",
          laneRunId: claim.lock.laneRunId,
          completedAt: "2026-05-21T05:03:00.000Z",
          terminalStatus: "revoked",
        }),
      /Lane run lock is already terminal: completed/,
    );

    const durableLock = await readLaneRunLock(stateRoot, "github-issue-110");
    const durableQueueRecord = await readLaneRunQueueRecord(stateRoot, "github-issue-110");

    assert.equal(durableLock.status, "completed");
    assert.equal(durableLock.releasedAt, completedAt);
    assert.equal(durableQueueRecord.status, "completed");
    assert.equal(durableQueueRecord.updatedAt, completedAt);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("bounds terminal queue metadata for long lane run ids", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    const longLaneRunId = `lane-run-110-${"a".repeat(260)}`;

    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });

    const claim = await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: longLaneRunId,
      claimedBy: "local-supervisor",
      claimedAt,
    });

    await completeLaneRunLock(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: claim.lock.laneRunId,
      completedAt,
      terminalStatus: "completed",
    });

    const durableLock = await readLaneRunLock(stateRoot, "github-issue-110");
    const durableQueueRecord = await readLaneRunQueueRecord(stateRoot, "github-issue-110");

    assert.equal(durableLock.laneRunId, longLaneRunId);
    assert.equal(durableQueueRecord.status, "completed");
    assert.equal(durableQueueRecord.metadata.completedLaneRunId.length, 256);
    assert.equal(durableQueueRecord.metadata.completedLaneRunId.endsWith("..."), true);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("rejects completion timestamps outside the active claim window", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });

    const claim = await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: "lane-run-110-a",
      claimedBy: "local-supervisor",
      claimedAt,
    });

    for (const invalidCompletedAt of ["2026-05-21T05:00:59.999Z", "2026-05-29T05:01:00.001Z"]) {
      await assert.rejects(
        () =>
          completeLaneRunLock(stateRoot, {
            stableWorkItemId: "github-issue-110",
            laneRunId: claim.lock.laneRunId,
            completedAt: invalidCompletedAt,
            terminalStatus: "completed",
          }),
        /completion timestamp must stay within the active claim window/,
      );
    }

    const durableLock = await readLaneRunLock(stateRoot, "github-issue-110");
    const durableQueueRecord = await readLaneRunQueueRecord(stateRoot, "github-issue-110");

    assert.equal(durableLock.status, "active");
    assert.equal(durableLock.active, true);
    assert.equal(durableQueueRecord.status, "queued");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("rejects completion timestamps beyond the local clock tolerance", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    const localClaimedAt = new Date().toISOString();
    const futureCompletedAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });

    const claim = await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: "lane-run-110-a",
      claimedBy: "local-supervisor",
      claimedAt: localClaimedAt,
    });

    assert.equal(claim.ok, true);

    await assert.rejects(
      () =>
        completeLaneRunLock(stateRoot, {
          stableWorkItemId: "github-issue-110",
          laneRunId: claim.lock.laneRunId,
          completedAt: futureCompletedAt,
          terminalStatus: "completed",
        }),
      /completion timestamp must stay within the active claim window/,
    );

    const durableLock = await readLaneRunLock(stateRoot, "github-issue-110");
    const durableQueueRecord = await readLaneRunQueueRecord(stateRoot, "github-issue-110");

    assert.equal(durableLock.status, "active");
    assert.equal(durableQueueRecord.status, "queued");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("rejects claim timestamps beyond the local clock tolerance", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });

    await assert.rejects(
      () =>
        claimQueuedLaneRun(stateRoot, {
          stableWorkItemId: "github-issue-110",
          laneRunId: "lane-run-110-a",
          claimedBy: "local-supervisor",
          claimedAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        }),
      /claim timestamp must stay within the local clock tolerance/,
    );

    const durableQueueRecord = await readLaneRunQueueRecord(stateRoot, "github-issue-110");
    assert.equal(durableQueueRecord.status, "queued");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("keeps committed queue state when directory sync fails after atomic rename", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));
  const queueDirectory = path.join(stateRoot, "lane-run-queue");

  try {
    await mkdir(queueDirectory, { recursive: true });
    await chmod(queueDirectory, 0o300);

    const queued = await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });

    await chmod(queueDirectory, 0o700);
    const durableQueueRecord = await readLaneRunQueueRecord(stateRoot, "github-issue-110");

    assert.equal(queued.status, "queued");
    assert.equal(durableQueueRecord.id, queued.id);
    assert.equal(durableQueueRecord.enqueueSequence, 1);
  } finally {
    await chmod(queueDirectory, 0o700).catch(() => undefined);
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("recovers a stale queue mutation lock before enqueueing", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    const mutationLockPath = path.join(stateRoot, "lane-run-mutation-locks", "github-issue-110.lock");
    await mkdir(mutationLockPath, { recursive: true });

    const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000);
    await utimes(mutationLockPath, staleTimestamp, staleTimestamp);

    const queued = await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });

    assert.equal(queued.status, "queued");

    const durableQueueRecord = await readLaneRunQueueRecord(stateRoot, "github-issue-110");
    assert.equal(durableQueueRecord.stableWorkItemId, "github-issue-110");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("does not reclaim a fresh queue mutation lock", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    const mutationLockPath = path.join(stateRoot, "lane-run-mutation-locks", "github-issue-110.lock");
    await mkdir(mutationLockPath, { recursive: true });

    await assert.rejects(
      () =>
        enqueueLaneRun(stateRoot, {
          stableWorkItemId: "github-issue-110",
          workItemId: "issue-110",
          source: "github-issue",
          laneId: "owner-dogfood",
          repositoryClassification: "owner-controlled-dogfood",
          queuedAt,
        }),
      /currently being modified/,
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("does not reclaim a stale-looking mutation lock that refreshes during recovery", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    const mutationLockPath = path.join(stateRoot, "lane-run-mutation-locks", "github-issue-110.lock");
    await mkdir(mutationLockPath, { recursive: true });

    const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000);
    await utimes(mutationLockPath, staleTimestamp, staleTimestamp);

    const refresh = delay(5).then(async () => {
      const refreshedAt = new Date();
      await utimes(mutationLockPath, refreshedAt, refreshedAt);
    });

    await assert.rejects(
      () =>
        enqueueLaneRun(stateRoot, {
          stableWorkItemId: "github-issue-110",
          workItemId: "issue-110",
          source: "github-issue",
          laneId: "owner-dogfood",
          repositoryClassification: "owner-controlled-dogfood",
          queuedAt,
        }),
      /currently being modified/,
    );

    await refresh;
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("recovers a stale queue mutation lock even when owner pid is currently alive", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    const mutationLockPath = path.join(stateRoot, "lane-run-mutation-locks", "github-issue-110.lock");
    const ownerPath = path.join(mutationLockPath, "owner.json");
    await mkdir(mutationLockPath, { recursive: true });
    await writeFile(
      ownerPath,
      JSON.stringify({
        schemaVersion: "ensen.lane-run-mutation-lock-owner.v1",
        token: "active-owner",
        pid: process.pid,
        acquiredAt: "2026-05-21T05:00:00.000Z",
      }),
      "utf8",
    );

    const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000);
    await utimes(ownerPath, staleTimestamp, staleTimestamp);
    await utimes(mutationLockPath, staleTimestamp, staleTimestamp);

    const queued = await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });

    assert.equal(queued.status, "queued");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("recovers a stale queue mutation lock when owner metadata is malformed", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    const mutationLockPath = path.join(stateRoot, "lane-run-mutation-locks", "github-issue-110.lock");
    const ownerPath = path.join(mutationLockPath, "owner.json");
    await mkdir(mutationLockPath, { recursive: true });
    await writeFile(ownerPath, "{\"schemaVersion\":\"ensen.lane-run-mutation-lock-owner.v1\"", "utf8");

    const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000);
    await utimes(ownerPath, staleTimestamp, staleTimestamp);
    await utimes(mutationLockPath, staleTimestamp, staleTimestamp);

    const queued = await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });

    assert.equal(queued.status, "queued");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("recovers a stale queue mutation lock before claiming", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });

    const mutationLockPath = path.join(stateRoot, "lane-run-mutation-locks", "github-issue-110.lock");
    await mkdir(mutationLockPath, { recursive: true });

    const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000);
    await utimes(mutationLockPath, staleTimestamp, staleTimestamp);

    const claim = await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: "lane-run-110-a",
      claimedBy: "local-supervisor",
      claimedAt,
    });

    assert.equal(claim.ok, true);
    assert.equal(claim.lock.status, "active");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("recovers a stale queue mutation lock before completing", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });

    const claim = await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: "lane-run-110-a",
      claimedBy: "local-supervisor",
      claimedAt,
    });

    const mutationLockPath = path.join(stateRoot, "lane-run-mutation-locks", "github-issue-110.lock");
    await mkdir(mutationLockPath, { recursive: true });

    const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000);
    await utimes(mutationLockPath, staleTimestamp, staleTimestamp);

    await completeLaneRunLock(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: claim.lock.laneRunId,
      completedAt,
      terminalStatus: "completed",
    });

    const durableLock = await readLaneRunLock(stateRoot, "github-issue-110");
    assert.equal(durableLock.status, "completed");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("keeps the active lock when queue completion cannot be persisted", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });

    const claim = await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: "lane-run-110-a",
      claimedBy: "local-supervisor",
      claimedAt,
    });
    const queuePath = resolveLaneRunQueueRecordPath(stateRoot, "github-issue-110");
    await chmod(path.dirname(queuePath), 0o500);

    await assert.rejects(() =>
      completeLaneRunLock(stateRoot, {
        stableWorkItemId: "github-issue-110",
        laneRunId: claim.lock.laneRunId,
        completedAt,
        terminalStatus: "completed",
      }),
    );

    const durableLock = await readLaneRunLock(stateRoot, "github-issue-110");
    const durableQueueRecord = await readLaneRunQueueRecord(stateRoot, "github-issue-110");

    assert.equal(durableLock.status, "active");
    assert.equal(durableLock.active, true);
    assert.equal(durableQueueRecord.status, "queued");
  } finally {
    await chmod(path.join(stateRoot, "lane-run-queue"), 0o700).catch(() => undefined);
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("fails closed when completion sees a queue record that does not match the active lock", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    const queued = await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });

    const claim = await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: "lane-run-110-a",
      claimedBy: "local-supervisor",
      claimedAt,
    });

    assert.equal(claim.ok, true);

    await writeFile(
      resolveLaneRunQueueRecordPath(stateRoot, "github-issue-110"),
      JSON.stringify({
        ...queued,
        id: "queue-github-issue-110-2",
        enqueueSequence: 2,
      }),
      "utf8",
    );

    await assert.rejects(
      () =>
        completeLaneRunLock(stateRoot, {
          stableWorkItemId: "github-issue-110",
          laneRunId: claim.lock.laneRunId,
          completedAt,
          terminalStatus: "completed",
        }),
      /queue record does not match the active lane run lock/,
    );

    const durableLock = await readLaneRunLock(stateRoot, "github-issue-110");
    const durableQueueRecord = await readLaneRunQueueRecord(stateRoot, "github-issue-110");

    assert.equal(durableLock.status, "active");
    assert.equal(durableQueueRecord.status, "queued");
    assert.equal(durableQueueRecord.id, "queue-github-issue-110-2");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("fails closed when a terminal lock is newer than the queued record", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    const queued = await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });

    const lockPath = resolveLaneRunLockPath(stateRoot, "github-issue-110");
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        schemaVersion: "ensen.lane-run-lock.v1",
        stableWorkItemId: "github-issue-110",
        queueRecordId: queued.id,
        laneRunId: "lane-run-110-a",
        laneId: "owner-dogfood",
        source: "github-issue",
        repositoryClassification: "owner-controlled-dogfood",
        status: "completed",
        active: false,
        claimedAt,
        claimedBy: "local-supervisor",
        releasedAt: completedAt,
        startsAgentExecution: false,
      }),
      "utf8",
    );

    const duplicate = await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: "lane-run-110-b",
      claimedBy: "local-supervisor",
      claimedAt: "2026-05-21T05:03:00.000Z",
    });

    assert.equal(duplicate.ok, false);
    assert.match(duplicate.reason, /stale queued record for terminal lane run lane-run-110-a/);

    const durableLock = await readLaneRunLock(stateRoot, "github-issue-110");
    const durableQueueRecord = await readLaneRunQueueRecord(stateRoot, "github-issue-110");

    assert.equal(durableLock.status, "completed");
    assert.equal(durableQueueRecord.status, "queued");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("fails closed when a terminal lock references a later queue record", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });

    const lockPath = resolveLaneRunLockPath(stateRoot, "github-issue-110");
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        schemaVersion: "ensen.lane-run-lock.v1",
        stableWorkItemId: "github-issue-110",
        queueRecordId: "queue-github-issue-110-2",
        laneRunId: "lane-run-110-b",
        laneId: "owner-dogfood",
        source: "github-issue",
        repositoryClassification: "owner-controlled-dogfood",
        status: "completed",
        active: false,
        claimedAt: "2026-05-21T05:03:00.000Z",
        claimedBy: "local-supervisor",
        releasedAt: "2026-05-21T05:04:00.000Z",
        startsAgentExecution: false,
      }),
      "utf8",
    );

    const duplicate = await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: "lane-run-110-c",
      claimedBy: "local-supervisor",
      claimedAt: "2026-05-21T05:05:00.000Z",
    });

    assert.equal(duplicate.ok, false);
    assert.match(duplicate.reason, /stale queued record for terminal lane run lane-run-110-b/);

    const durableLock = await readLaneRunLock(stateRoot, "github-issue-110");
    const durableQueueRecord = await readLaneRunQueueRecord(stateRoot, "github-issue-110");

    assert.equal(durableLock.status, "completed");
    assert.equal(durableQueueRecord.status, "queued");
    assert.equal(durableQueueRecord.enqueueSequence, 1);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("fails closed when terminal lock queue record reference is malformed", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });

    const lockPath = resolveLaneRunLockPath(stateRoot, "github-issue-110");
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        schemaVersion: "ensen.lane-run-lock.v1",
        stableWorkItemId: "github-issue-110",
        queueRecordId: "queue-other-work-item-2",
        laneRunId: "lane-run-110-b",
        laneId: "owner-dogfood",
        source: "github-issue",
        repositoryClassification: "owner-controlled-dogfood",
        status: "completed",
        active: false,
        claimedAt: "2026-05-21T05:03:00.000Z",
        claimedBy: "local-supervisor",
        releasedAt: "2026-05-21T05:04:00.000Z",
        startsAgentExecution: false,
      }),
      "utf8",
    );

    await assert.rejects(
      () =>
        claimQueuedLaneRun(stateRoot, {
          stableWorkItemId: "github-issue-110",
          laneRunId: "lane-run-110-c",
          claimedBy: "local-supervisor",
          claimedAt: "2026-05-21T05:05:00.000Z",
        }),
      /Lane run lock queue record reference is malformed/,
    );

    const durableQueueRecord = await readLaneRunQueueRecord(stateRoot, "github-issue-110");
    assert.equal(durableQueueRecord.status, "queued");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("fails closed when durable lock input is corrupted", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    const queued = await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });

    const lockPath = resolveLaneRunLockPath(stateRoot, "github-issue-110");
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        schemaVersion: "ensen.lane-run-lock.v1",
        stableWorkItemId: "github-issue-110",
        laneRunId: "lane-run-110-a",
        status: "active",
        active: true,
        claimedAt,
        claimedBy: "local-supervisor",
        queueRecordId: queued.id,
        startsAgentExecution: true,
      }),
      "utf8",
    );

    await assert.rejects(
      () =>
        claimQueuedLaneRun(stateRoot, {
          stableWorkItemId: "github-issue-110",
          laneRunId: "lane-run-110-b",
          claimedBy: "local-supervisor",
          claimedAt: "2026-05-21T05:01:30.000Z",
        }),
      /Lane run lock is malformed/,
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("fails closed when durable queue record id is not canonical", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    const queued = await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });

    await writeFile(
      resolveLaneRunQueueRecordPath(stateRoot, "github-issue-110"),
      JSON.stringify({
        ...queued,
        id: "queue-other-work-item-1",
      }),
      "utf8",
    );

    await assert.rejects(
      () =>
        claimQueuedLaneRun(stateRoot, {
          stableWorkItemId: "github-issue-110",
          laneRunId: "lane-run-110-a",
          claimedBy: "local-supervisor",
          claimedAt,
        }),
      /Lane run queue record is malformed/,
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("rejects stable work item identifiers with filename-unsafe colons", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    await assert.rejects(
      () =>
        enqueueLaneRun(stateRoot, {
          stableWorkItemId: "github:issue-110",
          workItemId: "issue-110",
          source: "github-issue",
          laneId: "owner-dogfood",
          repositoryClassification: "owner-controlled-dogfood",
          queuedAt,
        }),
      /Stable work item identifiers may only contain lowercase letters, numbers, dots, underscores, and hyphens/,
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("rejects non-canonical and reserved stable work item identifiers before filesystem mapping", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    for (const stableWorkItemId of ["GitHub-issue-110", "con", "lpt1.audit"]) {
      await assert.rejects(
        () =>
          enqueueLaneRun(stateRoot, {
            stableWorkItemId,
            workItemId: "issue-110",
            source: "github-issue",
            laneId: "owner-dogfood",
            repositoryClassification: "owner-controlled-dogfood",
            queuedAt,
          }),
        /reserved filenames/,
      );
    }
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("fails closed when an active lock already has a release timestamp", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    const queued = await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
    });

    const lockPath = resolveLaneRunLockPath(stateRoot, "github-issue-110");
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        schemaVersion: "ensen.lane-run-lock.v1",
        stableWorkItemId: "github-issue-110",
        laneRunId: "lane-run-110-a",
        laneId: "owner-dogfood",
        source: "github-issue",
        repositoryClassification: "owner-controlled-dogfood",
        status: "active",
        active: true,
        claimedAt,
        claimedBy: "local-supervisor",
        releasedAt: completedAt,
        queueRecordId: queued.id,
        startsAgentExecution: false,
      }),
      "utf8",
    );

    await assert.rejects(
      () =>
        claimQueuedLaneRun(stateRoot, {
          stableWorkItemId: "github-issue-110",
          laneRunId: "lane-run-110-b",
          claimedBy: "local-supervisor",
          claimedAt: "2026-05-21T05:01:30.000Z",
        }),
      /Lane run lock is malformed/,
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
