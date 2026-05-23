import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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
  writeLaneRunState,
} from "../src/lane/index.js";

const queuedAt = "2026-05-23T05:00:00.000Z";
const claimedAt = "2026-05-23T05:01:00.000Z";
const observedAt = "2026-05-23T05:02:00.000Z";

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
    readonly journalEntries?: Parameters<typeof createLaneJournal>[0]["entries"];
    readonly evidenceRefs?: readonly string[];
  } = {},
): Promise<void> {
  const laneRunId = input.laneRunId ?? "lane-run-113-a";

  await writeLaneRunState(
    stateRoot,
    createLaneRunState({
      id: laneRunId,
      workItemId: "issue-113",
      status: input.status ?? "running",
      revision: 1,
      createdAt: claimedAt,
      updatedAt: claimedAt,
      journal: createLaneJournal({
        id: `journal-${laneRunId}`,
        laneRunId,
        workItemId: "issue-113",
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
