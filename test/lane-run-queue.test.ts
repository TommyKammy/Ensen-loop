import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

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

    const secondClaim = await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: "lane-run-110-b",
      claimedBy: "local-supervisor",
      claimedAt: "2026-05-21T05:03:00.000Z",
    });

    assert.equal(secondClaim.ok, true);
    assert.equal(secondClaim.lock.status, "active");
    assert.equal(secondClaim.lock.laneRunId, "lane-run-110-b");
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

test("does not recover a stale queue mutation lock while its owner process is alive", async () => {
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

    assert.match(await readFile(ownerPath, "utf8"), /active-owner/);
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

test("fails closed when durable lock input is corrupted", async () => {
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
        laneRunId: "lane-run-110-a",
        status: "active",
        active: true,
        claimedAt,
        claimedBy: "local-supervisor",
        queueRecordId: "queue-github-issue-110",
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
        laneRunId: "lane-run-110-a",
        laneId: "owner-dogfood",
        source: "github-issue",
        repositoryClassification: "owner-controlled-dogfood",
        status: "active",
        active: true,
        claimedAt,
        claimedBy: "local-supervisor",
        releasedAt: completedAt,
        queueRecordId: "queue-github-issue-110",
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
