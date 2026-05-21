import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  claimQueuedLaneRun,
  completeLaneRunLock,
  enqueueLaneRun,
  readLaneRunLock,
  resolveLaneRunLockPath,
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
