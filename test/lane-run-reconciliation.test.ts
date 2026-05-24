import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  claimQueuedLaneRun,
  completeLaneRunLock,
  createLaneJournal,
  createLaneRunState,
  enqueueLaneRun,
  readLaneRunLock,
  readLaneRunQueueRecord,
  reconcileLaneRunState,
  resolveLaneRunLockPath,
  resolveLaneRunQueueRecordPath,
  retryLaneRun,
  writeLaneRunState,
} from "../src/lane/index.js";

const queuedAt = "2026-05-23T05:00:00.000Z";
const claimedAt = "2026-05-23T05:01:00.000Z";
const observedAt = "2026-05-23T05:02:00.000Z";

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

async function queueAndClaim(stateRoot: string, laneRunId = "lane-run-113-a") {
  const queued = await enqueueLaneRun(stateRoot, {
    stableWorkItemId: "github-issue-113",
    workItemId: "issue-113",
    source: "github-issue",
    laneId: "owner-dogfood",
    repositoryClassification: "owner-controlled-dogfood",
    queuedAt,
    metadata: {
      issueNumber: "113",
    },
  });
  const claim = await claimQueuedLaneRun(stateRoot, {
    stableWorkItemId: "github-issue-113",
    laneRunId,
    claimedBy: "local-supervisor",
    claimedAt,
  });

  return { queued, claim };
}

async function writeLaneState(
  stateRoot: string,
  input: {
    readonly laneRunId?: string;
    readonly status?: "running" | "completed" | "failed" | "blocked";
    readonly workItemId?: string;
    readonly journalEntries?: Parameters<typeof createLaneJournal>[0]["entries"];
    readonly evidenceRefs?: readonly string[];
  } = {},
): Promise<void> {
  const laneRunId = input.laneRunId ?? "lane-run-113-a";
  const workItemId = input.workItemId ?? "issue-113";

  await writeLaneRunState(
    stateRoot,
    createLaneRunState({
      id: laneRunId,
      workItemId,
      status: input.status ?? "running",
      revision: 1,
      createdAt: claimedAt,
      updatedAt: claimedAt,
      journal: createLaneJournal({
        id: `journal-${laneRunId}`,
        laneRunId,
        workItemId,
        entries:
          input.journalEntries ??
          [
            {
              id: `${laneRunId}-branch`,
              recordedAt: claimedAt,
              kind: "change",
              message: "branch intent: codex/issue-113 from main",
            },
          ],
      }),
      evidence: {
        bundleRefs: input.evidenceRefs ?? ["artifacts/evidence/lane-run-113-a.json"],
      },
    }),
  );
}

test("reconciliation fails closed when an active lane run is missing its branch", async () => {
  await withStateRoot(async (stateRoot) => {
    const { queued, claim } = await queueAndClaim(stateRoot);
    await writeLaneState(stateRoot);

    const originalState = await readFile(path.join(stateRoot, "lane-runs", "lane-run-113-a.json"), "utf8");
    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      observedAt,
      surfaces: {
        branch: { expected: true, exists: false, ref: "codex/issue-113" },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: false, exists: false },
        verificationFacts: [{ status: "running", source: "operator-status" }],
      },
    });

    assert.equal(result.state, "blocked");
    assert.equal(result.category, "blocked");
    assert.equal(result.publicDiagnostics.reason, "active lane run is missing its branch");
    assert.equal(result.nextOperatorAction, "stop the active lane run, inspect evidence, then requeue explicitly if safe");
    assert.deepEqual(result.evidence.bundleRefs, ["artifacts/evidence/lane-run-113-a.json"]);
    assert.equal(JSON.stringify(result).includes(stateRoot), false);
    assert.deepEqual(await readLaneRunQueueRecord(stateRoot, "github-issue-113"), queued);
    assert.deepEqual(await readLaneRunLock(stateRoot, "github-issue-113"), claim.lock);
    assert.equal(await readFile(path.join(stateRoot, "lane-runs", "lane-run-113-a.json"), "utf8"), originalState);
  });
});

test("reconciliation classifies an active lock without lane state as safe to requeue after explicit cleanup", async () => {
  await withStateRoot(async (stateRoot) => {
    const { queued, claim } = await queueAndClaim(stateRoot);

    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      observedAt,
      surfaces: {
        branch: { expected: true, exists: true, ref: "codex/issue-113" },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: false, exists: false },
        verificationFacts: [{ status: "running", source: "operator-status" }],
      },
    });

    assert.equal(result.state, "blocked");
    assert.equal(result.category, "safe-to-requeue");
    assert.equal(result.publicDiagnostics.reason, "active lane run lock has no lane state");
    assert.equal(result.mismatches[0]?.kind, "stale-lock");
    assert.deepEqual(result.evidence.bundleRefs, []);
    assert.deepEqual(await readLaneRunQueueRecord(stateRoot, "github-issue-113"), queued);
    assert.deepEqual(await readLaneRunLock(stateRoot, "github-issue-113"), claim.lock);
  });
});

test("reconciliation reads authoritative active lock state before reporting target mismatch", async () => {
  await withStateRoot(async (stateRoot) => {
    await queueAndClaim(stateRoot);
    await writeLaneState(stateRoot, {
      evidenceRefs: ["artifacts/evidence/active-lane.json"],
    });

    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-stale",
      observedAt,
      surfaces: {
        branch: { expected: true, exists: true, ref: "codex/issue-113" },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: false, exists: false },
        verificationFacts: [{ status: "running", source: "operator-status" }],
      },
    });

    assert.equal(result.state, "blocked");
    assert.equal(result.category, "blocked");
    assert.equal(result.laneRunId, "lane-run-113-a");
    assert.deepEqual(result.evidence.bundleRefs, ["artifacts/evidence/active-lane.json"]);
    assert.equal(result.mismatches.some((mismatch) => mismatch.kind === "lane-run-target-mismatch"), true);
    assert.equal(result.mismatches.some((mismatch) => mismatch.kind === "stale-lock"), false);
  });
});

test("reconciliation blocks active lock and queue record divergence", async () => {
  await withStateRoot(async (stateRoot) => {
    const { claim } = await queueAndClaim(stateRoot);
    await writeLaneState(stateRoot);
    await writeFile(
      resolveLaneRunLockPath(stateRoot, "github-issue-113"),
      JSON.stringify({ ...claim.lock, queueRecordId: "queue-github-issue-113-999" }),
      "utf8",
    );

    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      observedAt,
      surfaces: {
        branch: { expected: true, exists: true, ref: "codex/issue-113" },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: false, exists: false },
        verificationFacts: [{ status: "running", source: "operator-status" }],
      },
    });

    assert.equal(result.state, "blocked");
    assert.equal(result.category, "blocked");
    assert.equal(result.publicDiagnostics.reason, "active lane run lock does not match the queue record");
    assert.equal(result.mismatches[0]?.kind, "lock-queue-record-mismatch");
  });
});

test("reconciliation blocks lock identity drift without exposing same-work-item evidence", async () => {
  await withStateRoot(async (stateRoot) => {
    const { claim } = await queueAndClaim(stateRoot);
    await writeLaneState(stateRoot, {
      evidenceRefs: ["artifacts/evidence/drifted-lock-private.json"],
    });
    await writeFile(
      resolveLaneRunLockPath(stateRoot, "github-issue-113"),
      JSON.stringify({ ...claim.lock, source: "manual-import" }),
      "utf8",
    );

    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      observedAt,
      surfaces: {
        branch: { expected: true, exists: true, ref: "codex/issue-113" },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: false, exists: false },
        verificationFacts: [{ status: "running", source: "operator-status" }],
      },
    });

    assert.equal(result.state, "blocked");
    assert.equal(result.category, "blocked");
    assert.equal(result.publicDiagnostics.reason, "active lane run lock context does not match the queue record");
    assert.equal(result.mismatches.some((mismatch) => mismatch.kind === "lane-run-ownership-unverified"), true);
    assert.equal(result.mismatches.some((mismatch) => mismatch.kind === "stale-lock"), false);
    assert.deepEqual(result.evidence.bundleRefs, []);
  });
});

test("reconciliation blocks stale-lock advice when active lock identity drifts without lane state", async () => {
  await withStateRoot(async (stateRoot) => {
    const { claim } = await queueAndClaim(stateRoot);
    await writeFile(
      resolveLaneRunLockPath(stateRoot, "github-issue-113"),
      JSON.stringify({ ...claim.lock, source: "manual-import" }),
      "utf8",
    );

    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      observedAt,
      surfaces: {
        branch: { expected: true, exists: true, ref: "codex/issue-113" },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: false, exists: false },
        verificationFacts: [{ status: "running", source: "operator-status" }],
      },
    });

    assert.equal(result.state, "blocked");
    assert.equal(result.category, "blocked");
    assert.equal(result.publicDiagnostics.reason, "active lane run lock context does not match the queue record");
    assert.equal(result.mismatches.some((mismatch) => mismatch.kind === "lane-run-ownership-unverified"), true);
    assert.equal(result.mismatches.some((mismatch) => mismatch.kind === "stale-lock"), false);
    assert.deepEqual(result.evidence.bundleRefs, []);
  });
});

test("reconciliation prefers active-lock cleanup guidance when queue state is missing", async () => {
  await withStateRoot(async (stateRoot) => {
    await queueAndClaim(stateRoot);
    await rm(resolveLaneRunQueueRecordPath(stateRoot, "github-issue-113"), { force: true });

    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      observedAt,
      surfaces: {
        branch: { expected: true, exists: true, ref: "codex/issue-113" },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: false, exists: false },
        verificationFacts: [{ status: "running", source: "operator-status" }],
      },
    });

    assert.equal(result.state, "blocked");
    assert.equal(result.category, "blocked");
    assert.equal(result.publicDiagnostics.reason, "active lane run lock has no queue record");
    assert.equal(
      result.nextOperatorAction,
      "stop or remove the active lock, then enqueue or requeue explicitly if the issue is still selected",
    );
    assert.equal(result.mismatches[0]?.kind, "missing-queue-record");
  });
});

test("reconciliation accepts explicit terminal lock lane run id after retry queues a new attempt", async () => {
  await withStateRoot(async (stateRoot) => {
    await queueAndClaim(stateRoot);
    await writeLaneState(stateRoot, {
      status: "failed",
      evidenceRefs: ["artifacts/evidence/retry-source.json"],
    });
    await completeLaneRunLock(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      completedAt: observedAt,
      terminalStatus: "superseded",
    });

    const retry = await retryLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      reason: "retry after focused fix",
      actedAt: "2026-05-23T05:03:00.000Z",
    });

    assert.equal(retry.ok, true);
    assert.equal((await readLaneRunQueueRecord(stateRoot, "github-issue-113")).status, "queued");

    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      observedAt: "2026-05-23T05:04:00.000Z",
      surfaces: {
        branch: { expected: true, exists: true, ref: "codex/issue-113" },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: false, exists: false },
        verificationFacts: [{ status: "failed", source: "operator-status" }],
      },
    });

    assert.equal(result.state, "ok");
    assert.equal(result.laneRunId, "lane-run-113-a");
    assert.deepEqual(result.evidence.bundleRefs, ["artifacts/evidence/retry-source.json"]);
    assert.equal(result.mismatches.some((mismatch) => mismatch.kind === "lane-run-ownership-unverified"), false);
  });
});

test("reconciliation classifies a missing terminal worktree as cleanup-required without deleting evidence", async () => {
  await withStateRoot(async (stateRoot) => {
    await queueAndClaim(stateRoot);
    await completeLaneRunLock(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      completedAt: observedAt,
      terminalStatus: "completed",
    });
    await writeLaneState(stateRoot, {
      status: "completed",
      evidenceRefs: ["artifacts/evidence/completed-lane.json"],
    });
    const originalState = await readFile(path.join(stateRoot, "lane-runs", "lane-run-113-a.json"), "utf8");

    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      observedAt,
      surfaces: {
        branch: { expected: true, exists: true, ref: "codex/issue-113" },
        worktree: { expected: true, exists: false, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: false, exists: false },
        verificationFacts: [{ status: "succeeded", source: "operator-status" }],
      },
    });

    assert.equal(result.state, "blocked");
    assert.equal(result.category, "needs-cleanup");
    assert.equal(result.publicDiagnostics.reason, "terminal lane run is missing its worktree");
    assert.deepEqual(result.evidence.bundleRefs, ["artifacts/evidence/completed-lane.json"]);
    assert.equal(await readFile(path.join(stateRoot, "lane-runs", "lane-run-113-a.json"), "utf8"), originalState);
  });
});

test("reconciliation derives terminal lane run id from queue metadata when input omits it", async () => {
  await withStateRoot(async (stateRoot) => {
    await queueAndClaim(stateRoot);
    await completeLaneRunLock(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      completedAt: observedAt,
      terminalStatus: "completed",
    });
    await writeLaneState(stateRoot, {
      status: "completed",
      evidenceRefs: ["artifacts/evidence/completed-lane.json"],
    });
    await rm(resolveLaneRunLockPath(stateRoot, "github-issue-113"), { force: true });

    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      observedAt,
      surfaces: {
        branch: { expected: true, exists: true, ref: "codex/issue-113" },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: false, exists: false },
        verificationFacts: [{ status: "succeeded", source: "operator-status" }],
      },
    });

    assert.equal(result.state, "ok");
    assert.equal(result.laneRunId, "lane-run-113-a");
    assert.deepEqual(result.evidence.bundleRefs, ["artifacts/evidence/completed-lane.json"]);
  });
});

test("reconciliation recovers truncated terminal metadata from the lane run id digest", async () => {
  await withStateRoot(async (stateRoot) => {
    await queueAndClaim(stateRoot);
    await completeLaneRunLock(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      completedAt: observedAt,
      terminalStatus: "completed",
    });
    await writeLaneState(stateRoot, {
      status: "completed",
      evidenceRefs: ["artifacts/evidence/completed-lane.json"],
    });
    await rm(resolveLaneRunLockPath(stateRoot, "github-issue-113"), { force: true });

    const queue = await readLaneRunQueueRecord(stateRoot, "github-issue-113");
    await writeFile(
      resolveLaneRunQueueRecordPath(stateRoot, "github-issue-113"),
      JSON.stringify({
        ...queue,
        metadata: {
          ...queue.metadata,
          completedLaneRunId: `${"lane-run-113-".padEnd(253, "a")}...`,
          completedLaneRunIdSha256: laneRunIdDigest("lane-run-113-a"),
        },
      }),
      "utf8",
    );

    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      observedAt,
      surfaces: {
        branch: { expected: true, exists: true, ref: "codex/issue-113" },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: false, exists: false },
        verificationFacts: [{ status: "succeeded", source: "operator-status" }],
      },
    });

    assert.equal(result.state, "ok");
    assert.equal(result.laneRunId, "lane-run-113-a");
    assert.deepEqual(result.evidence.bundleRefs, ["artifacts/evidence/completed-lane.json"]);
  });
});

test("reconciliation prefers terminal queue metadata over an incompatible terminal lock", async () => {
  await withStateRoot(async (stateRoot) => {
    await queueAndClaim(stateRoot);
    await completeLaneRunLock(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      completedAt: observedAt,
      terminalStatus: "completed",
    });
    await writeLaneState(stateRoot, {
      status: "completed",
      evidenceRefs: ["artifacts/evidence/completed-lane.json"],
    });

    const terminalLock = await readLaneRunLock(stateRoot, "github-issue-113");
    await writeFile(
      resolveLaneRunLockPath(stateRoot, "github-issue-113"),
      JSON.stringify({ ...terminalLock, laneRunId: "lane-run-113-b", source: "manual-import" }),
      "utf8",
    );

    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      observedAt,
      surfaces: {
        branch: { expected: true, exists: true, ref: "codex/issue-113" },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: false, exists: false },
        verificationFacts: [{ status: "succeeded", source: "operator-status" }],
      },
    });

    assert.equal(result.state, "ok");
    assert.equal(result.laneRunId, "lane-run-113-a");
    assert.deepEqual(result.evidence.bundleRefs, ["artifacts/evidence/completed-lane.json"]);
  });
});

test("reconciliation reports missing terminal lane state derived from queue metadata", async () => {
  await withStateRoot(async (stateRoot) => {
    await queueAndClaim(stateRoot);
    await completeLaneRunLock(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      completedAt: observedAt,
      terminalStatus: "completed",
    });
    await rm(resolveLaneRunLockPath(stateRoot, "github-issue-113"), { force: true });

    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      observedAt,
      surfaces: {
        branch: { expected: true, exists: true, ref: "codex/issue-113" },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: false, exists: false },
        verificationFacts: [{ status: "succeeded", source: "operator-status" }],
      },
    });

    assert.equal(result.state, "blocked");
    assert.equal(result.category, "manual-review");
    assert.equal(result.laneRunId, "lane-run-113-a");
    assert.equal(result.publicDiagnostics.reason, "terminal lane run state is missing");
    assert.equal(result.mismatches[0]?.kind, "missing-lane-state");
    assert.deepEqual(result.evidence.bundleRefs, []);
  });
});

test("reconciliation preserves exact 256-character terminal lane run ids ending with ellipsis", async () => {
  await withStateRoot(async (stateRoot) => {
    const exactLaneRunId = `${"lane-run-113-".padEnd(253, "a")}...`;

    assert.equal(exactLaneRunId.length, 256);

    await queueAndClaim(stateRoot, exactLaneRunId);
    await completeLaneRunLock(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: exactLaneRunId,
      completedAt: observedAt,
      terminalStatus: "completed",
    });
    await rm(resolveLaneRunLockPath(stateRoot, "github-issue-113"), { force: true });

    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      observedAt,
      surfaces: {
        branch: { expected: true, exists: true, ref: "codex/issue-113" },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: false, exists: false },
        verificationFacts: [{ status: "succeeded", source: "operator-status" }],
      },
    });

    assert.equal(result.state, "blocked");
    assert.equal(result.category, "manual-review");
    assert.equal(result.laneRunId, exactLaneRunId);
    assert.equal(result.publicDiagnostics.reason, "terminal lane run state is missing");
    assert.equal(result.mismatches[0]?.kind, "missing-lane-state");
  });
});

test("reconciliation blocks unlinked terminal targets without reporting active-lock target mismatch", async () => {
  await withStateRoot(async (stateRoot) => {
    await queueAndClaim(stateRoot);
    await completeLaneRunLock(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      completedAt: observedAt,
      terminalStatus: "completed",
    });
    await writeLaneState(stateRoot, {
      laneRunId: "lane-run-113-b",
      status: "completed",
    });

    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-b",
      observedAt,
      surfaces: {
        branch: { expected: true, exists: true, ref: "codex/issue-113" },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: false, exists: false },
        verificationFacts: [{ status: "succeeded", source: "operator-status" }],
      },
    });

    assert.equal(result.state, "blocked");
    assert.equal(result.category, "blocked");
    assert.equal(result.laneRunId, undefined);
    assert.equal(result.mismatches.some((mismatch) => mismatch.kind === "lane-run-target-mismatch"), false);
    assert.equal(result.mismatches.some((mismatch) => mismatch.kind === "lane-run-ownership-unverified"), true);
    assert.deepEqual(result.evidence.bundleRefs, []);
  });
});

test("reconciliation blocks unlinked same-work-item lane state without exposing evidence", async () => {
  await withStateRoot(async (stateRoot) => {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-113",
      workItemId: "issue-113",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
      metadata: {
        issueNumber: "113",
      },
    });
    await writeLaneState(stateRoot, {
      laneRunId: "lane-run-999-a",
      workItemId: "issue-113",
      evidenceRefs: ["artifacts/evidence/other-issue-private.json"],
    });

    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-999-a",
      observedAt,
      surfaces: {
        branch: { expected: true, exists: true, ref: "codex/issue-999" },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: false, exists: false },
        verificationFacts: [{ status: "running", source: "operator-status" }],
      },
    });

    assert.equal(result.state, "blocked");
    assert.equal(result.category, "blocked");
    assert.equal(result.publicDiagnostics.reason, "lane run state ownership is unverifiable");
    assert.equal(result.mismatches[0]?.kind, "lane-run-ownership-unverified");
    assert.deepEqual(result.evidence.bundleRefs, []);
  });
});

test("reconciliation does not expose evidence when queue ownership is missing", async () => {
  await withStateRoot(async (stateRoot) => {
    await queueAndClaim(stateRoot);
    await writeLaneState(stateRoot, {
      evidenceRefs: ["artifacts/evidence/unverified-private.json"],
    });
    await rm(resolveLaneRunQueueRecordPath(stateRoot, "github-issue-113"), { force: true });

    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      observedAt,
      surfaces: {
        branch: { expected: true, exists: true, ref: "codex/issue-113" },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: false, exists: false },
        verificationFacts: [{ status: "running", source: "operator-status" }],
      },
    });

    assert.equal(result.state, "blocked");
    assert.equal(result.category, "blocked");
    assert.equal(result.publicDiagnostics.reason, "active lane run lock has no queue record");
    assert.equal(result.mismatches.some((mismatch) => mismatch.kind === "lane-run-ownership-unverified"), true);
    assert.equal(result.mismatches.some((mismatch) => mismatch.kind === "stale-lock"), false);
    assert.deepEqual(result.evidence.bundleRefs, []);
  });
});

test("reconciliation skips stale-lock classification after rejecting mismatched work-item state", async () => {
  await withStateRoot(async (stateRoot) => {
    await queueAndClaim(stateRoot);
    await writeLaneState(stateRoot, {
      workItemId: "issue-999",
      evidenceRefs: ["artifacts/evidence/mismatched-work-item.json"],
    });

    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      observedAt,
      surfaces: {
        branch: { expected: true, exists: true, ref: "codex/issue-113" },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: false, exists: false },
        verificationFacts: [{ status: "running", source: "operator-status" }],
      },
    });

    assert.equal(result.state, "blocked");
    assert.equal(result.category, "blocked");
    assert.equal(result.publicDiagnostics.reason, "lane run state does not belong to the requested work item");
    assert.equal(result.mismatches.some((mismatch) => mismatch.kind === "lane-run-work-item-mismatch"), true);
    assert.equal(result.mismatches.some((mismatch) => mismatch.kind === "stale-lock"), false);
    assert.deepEqual(result.evidence.bundleRefs, []);
  });
});

test("reconciliation sends missing journal evidence to manual review", async () => {
  await withStateRoot(async (stateRoot) => {
    await queueAndClaim(stateRoot);
    await writeLaneState(stateRoot, {
      journalEntries: [],
    });

    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      observedAt,
      surfaces: {
        branch: { expected: true, exists: true, ref: "codex/issue-113" },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: false },
        prDraft: { expected: false, exists: false },
        verificationFacts: [{ status: "running", source: "operator-status" }],
      },
    });

    assert.equal(result.state, "blocked");
    assert.equal(result.category, "manual-review");
    assert.equal(result.publicDiagnostics.reason, "lane run journal entry is missing");
    assert.equal(result.nextOperatorAction, "manually review preserved evidence before retrying, requeueing, or cleaning up the lane");
  });
});

test("reconciliation returns blocked diagnostics for malformed lane state", async () => {
  await withStateRoot(async (stateRoot) => {
    await queueAndClaim(stateRoot);
    await writeFile(path.join(stateRoot, "lane-runs", "lane-run-113-a.json"), "{", "utf8");

    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      observedAt,
      surfaces: {
        branch: { expected: true, exists: true, ref: "codex/issue-113" },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: false, exists: false },
        verificationFacts: [{ status: "running", source: "operator-status" }],
      },
    });

    assert.equal(result.state, "blocked");
    assert.equal(result.category, "blocked");
    assert.equal(result.publicDiagnostics.reason, "lane run state is malformed");
    assert.equal(result.nextOperatorAction, "repair or remove malformed lane state before continuing");
    assert.equal(result.mismatches[0]?.kind, "malformed-lane-state");
    assert.deepEqual(result.evidence.bundleRefs, []);
  });
});

test("reconciliation returns blocked diagnostics for malformed surfaces input", async () => {
  await withStateRoot(async (stateRoot) => {
    const missingSurfacesResult = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      observedAt,
    } as unknown as Parameters<typeof reconcileLaneRunState>[1]);

    assert.equal(missingSurfacesResult.state, "blocked");
    assert.equal(missingSurfacesResult.category, "blocked");
    assert.equal(missingSurfacesResult.publicDiagnostics.reason, "lane run reconciliation input is malformed");
    assert.equal(missingSurfacesResult.mismatches[0]?.kind, "malformed-reconciliation-input");
    assert.equal(
      missingSurfacesResult.nextOperatorAction,
      "provide a valid reconciliation surfaces payload before retrying",
    );

    const malformedFactsResult = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      observedAt,
      surfaces: {
        branch: { expected: true, exists: true, ref: "codex/issue-113" },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: false, exists: false },
        verificationFacts: [null],
      },
    } as unknown as Parameters<typeof reconcileLaneRunState>[1]);

    assert.equal(malformedFactsResult.state, "blocked");
    assert.equal(malformedFactsResult.category, "blocked");
    assert.equal(malformedFactsResult.publicDiagnostics.reason, "lane run reconciliation input is malformed");
    assert.equal(malformedFactsResult.mismatches[0]?.kind, "malformed-reconciliation-input");
    assert.equal(
      malformedFactsResult.nextOperatorAction,
      "provide verification facts with source and status fields before retrying",
    );
  });
});

test("reconciliation blocks missing PR draft advice for active lane runs", async () => {
  await withStateRoot(async (stateRoot) => {
    await queueAndClaim(stateRoot);
    await writeLaneState(stateRoot);

    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      observedAt,
      surfaces: {
        branch: { expected: true, exists: true, ref: "codex/issue-113" },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: true, exists: false, ref: "draft-pr" },
        verificationFacts: [{ status: "running", source: "operator-status" }],
      },
    });

    assert.equal(result.state, "blocked");
    assert.equal(result.category, "blocked");
    assert.equal(result.publicDiagnostics.reason, "active lane run is missing its PR draft reference");
    assert.equal(result.nextOperatorAction, "stop the active lane run, inspect evidence, then requeue explicitly if safe");
    assert.equal(result.mismatches[0]?.kind, "missing-pr-draft");
  });
});

test("reconciliation distinguishes a missing PR draft reference as requeue-eligible", async () => {
  await withStateRoot(async (stateRoot) => {
    await queueAndClaim(stateRoot);
    await writeLaneState(stateRoot, {
      status: "failed",
    });
    await completeLaneRunLock(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      completedAt: observedAt,
      terminalStatus: "superseded",
    });

    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      observedAt,
      surfaces: {
        branch: { expected: true, exists: true, ref: "codex/issue-113" },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: true, exists: false, ref: "draft-pr" },
        verificationFacts: [{ status: "failed", source: "operator-status" }],
      },
    });

    assert.equal(result.state, "blocked");
    assert.equal(result.category, "safe-to-requeue");
    assert.equal(result.publicDiagnostics.reason, "lane run is missing its PR draft reference");
    assert.equal(result.mismatches[0]?.kind, "missing-pr-draft");
  });
});

test("reconciliation fails closed for conflicting verification facts", async () => {
  await withStateRoot(async (stateRoot) => {
    await queueAndClaim(stateRoot);
    await writeLaneState(stateRoot, {
      status: "completed",
    });

    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      observedAt,
      surfaces: {
        branch: { expected: true, exists: true, ref: "codex/issue-113" },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: false, exists: false },
        verificationFacts: [
          { status: "succeeded", source: "operator-status" },
          { status: "running", source: "verification-summary" },
        ],
      },
    });

    assert.equal(result.state, "blocked");
    assert.equal(result.category, "manual-review");
    assert.equal(result.publicDiagnostics.reason, "verification facts conflict with authoritative lane state");
    assert.equal(result.mismatches[0]?.kind, "conflicting-verification-facts");
  });
});

test("reconciliation ignores unknown verification facts as non-authoritative", async () => {
  await withStateRoot(async (stateRoot) => {
    await queueAndClaim(stateRoot);
    await writeLaneState(stateRoot, {
      status: "completed",
    });

    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      observedAt,
      surfaces: {
        branch: { expected: true, exists: true, ref: "codex/issue-113" },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: false, exists: false },
        verificationFacts: [
          { status: "unknown", source: "operator-status" },
          { status: "succeeded", source: "verification-summary" },
        ],
      },
    });

    assert.equal(result.state, "ok");
    assert.equal(result.mismatches.some((mismatch) => mismatch.kind === "conflicting-verification-facts"), false);
  });
});

test("reconciliation public diagnostics redact workstation paths and secret-looking refs", async () => {
  await withStateRoot(async (stateRoot) => {
    await queueAndClaim(stateRoot);
    await writeLaneState(stateRoot);
    const workstationPath = ["", "Users", "example", "private", "repo"].join("/");

    const result = await reconcileLaneRunState(stateRoot, {
      stableWorkItemId: "github-issue-113",
      laneRunId: "lane-run-113-a",
      observedAt,
      surfaces: {
        branch: {
          expected: true,
          exists: false,
          ref: `${workstationPath} token=ghp_sampleSecretValue`,
        },
        worktree: { expected: true, exists: true, ref: "<lane-worktree>" },
        journal: { expected: true, exists: true },
        prDraft: { expected: false, exists: false },
        verificationFacts: [{ status: "running", source: "operator-status" }],
      },
    });
    const serialized = JSON.stringify(result);

    assert.equal(serialized.includes(workstationPath), false);
    assert.equal(serialized.includes("ghp_sampleSecretValue"), false);
    assert.equal(result.mismatches[0]?.ref, "<redacted>");
  });
});
