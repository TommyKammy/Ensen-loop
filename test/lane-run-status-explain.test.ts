import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  claimQueuedLaneRun,
  completeLaneRunLock,
  enqueueLaneRun,
  explainLaneRun,
  getLaneRunStatus,
  resolveLaneRunQueueRecordPath,
} from "../src/lane/index.js";

const execFileAsync = promisify(execFile);
const queuedAt = "2026-05-22T00:00:00.000Z";
const claimedAt = "2026-05-22T00:01:00.000Z";

async function withStateRoot(callback: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    await callback(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

test("status shows queued and active lock state without leaking local paths", async () => {
  await withStateRoot(async (stateRoot) => {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-111",
      workItemId: "issue-111",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
      metadata: {
        issueNumber: "111",
      },
    });
    await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-111",
      laneRunId: "lane-run-111-a",
      claimedBy: "operator-token=ghp_sampleSecretValue",
      claimedAt,
    });

    const status = await getLaneRunStatus(stateRoot);

    assert.deepEqual(status, {
      schemaVersion: "ensen.lane-run-status.v1",
      state: "ok",
      queue: [
        {
          selectedIssue: "#111",
          stableWorkItemId: "github-issue-111",
          laneId: "owner-dogfood",
          laneState: "active",
          verificationState: "running",
          blockerReason: undefined,
          nextOperatorAction: "wait for active lane run lane-run-111-a to finish",
          activeLock: {
            laneRunId: "lane-run-111-a",
            status: "active",
          },
        },
      ],
    });
    assert.equal(JSON.stringify(status).includes(stateRoot), false);
    assert.equal(JSON.stringify(status).includes("ghp_sampleSecretValue"), false);
  });
});

test("explain fails closed when no selected issue exists", async () => {
  await withStateRoot(async (stateRoot) => {
    const explanation = await explainLaneRun(stateRoot);

    assert.equal(explanation.state, "blocked");
    assert.equal(explanation.laneState, "blocked");
    assert.equal(explanation.verificationState, "unknown");
    assert.equal(explanation.blockerReason, "no selected issue");
    assert.equal(explanation.nextOperatorAction, "select or enqueue a lane run before claiming readiness");
  });
});

test("explain identifies blocked active lane run and safe next action", async () => {
  await withStateRoot(async (stateRoot) => {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-111",
      workItemId: "issue-111",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
      metadata: {
        issueNumber: "111",
        blockerReason: "verification token=ghp_sampleSecretValue failed",
      },
    });

    const status = await getLaneRunStatus(stateRoot);
    const explanation = await explainLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-111",
    });

    assert.equal(status.state, "blocked");
    assert.equal(status.blockerReason, "verification <redacted> failed");
    assert.equal(status.nextOperatorAction, "resolve blocker before claiming or running the lane");
    assert.equal(explanation.selectedIssue, "#111");
    assert.equal(explanation.laneState, "blocked");
    assert.equal(explanation.verificationState, "blocked");
    assert.equal(explanation.blockerReason, "verification <redacted> failed");
    assert.equal(explanation.nextOperatorAction, "resolve blocker before claiming or running the lane");
    assert.equal(JSON.stringify(explanation).includes("ghp_sampleSecretValue"), false);
  });
});

test("malformed queue state is reported as blocked instead of ready", async () => {
  await withStateRoot(async (stateRoot) => {
    const queuePath = resolveLaneRunQueueRecordPath(stateRoot, "github-issue-111");
    await mkdir(path.dirname(queuePath), { recursive: true });
    await writeFile(queuePath, "{\"schemaVersion\":\"ensen.lane-run-queue.v1\"}\n", {
      encoding: "utf8",
    });

    const status = await getLaneRunStatus(stateRoot);
    const explanation = await explainLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-111",
    });

    assert.equal(status.state, "blocked");
    assert.equal(status.queue.length, 0);
    assert.equal(status.blockerReason, "lane run state is malformed");
    assert.equal(status.nextOperatorAction, "repair or remove malformed lane state before continuing");
    assert.equal(explanation.state, "blocked");
    assert.equal(explanation.laneState, "blocked");
    assert.equal(explanation.verificationState, "unknown");
    assert.equal(explanation.blockerReason, "lane run state is malformed");
    assert.equal(explanation.nextOperatorAction, "repair or remove malformed lane state before continuing");
  });
});

test("syntactically invalid queue JSON is reported as malformed status and explanation", async () => {
  await withStateRoot(async (stateRoot) => {
    const queuePath = resolveLaneRunQueueRecordPath(stateRoot, "github-issue-111");
    await mkdir(path.dirname(queuePath), { recursive: true });
    await writeFile(queuePath, "{ nope\n", {
      encoding: "utf8",
    });

    const status = await getLaneRunStatus(stateRoot);
    const explanation = await explainLaneRun(stateRoot);

    assert.equal(status.state, "blocked");
    assert.equal(status.blockerReason, "lane run state is malformed");
    assert.equal(explanation.state, "blocked");
    assert.equal(explanation.blockerReason, "lane run state is malformed");
    assert.equal(explanation.nextOperatorAction, "repair or remove malformed lane state before continuing");
  });
});

test("explain without issue prefers actionable queue items over terminal history", async () => {
  await withStateRoot(async (stateRoot) => {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      workItemId: "issue-110",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt: "2026-05-22T00:00:00.000Z",
      metadata: {
        issueNumber: "110",
      },
    });
    const claim = await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: "lane-run-110-a",
      claimedBy: "local-supervisor",
      claimedAt: "2026-05-22T00:01:00.000Z",
    });
    await completeLaneRunLock(stateRoot, {
      stableWorkItemId: "github-issue-110",
      laneRunId: claim.lock.laneRunId,
      completedAt: "2026-05-22T00:02:00.000Z",
      terminalStatus: "completed",
    });
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-111",
      workItemId: "issue-111",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt: "2026-05-22T00:03:00.000Z",
      metadata: {
        issueNumber: "111",
      },
    });

    const explanation = await explainLaneRun(stateRoot);

    assert.equal(explanation.selectedIssue, "#111");
    assert.equal(explanation.laneState, "queued");
    assert.equal(explanation.nextOperatorAction, "claim queued lane run when ready");
  });
});

test("terminal locks drive next action even when the queue record is stale queued", async () => {
  await withStateRoot(async (stateRoot) => {
    const queued = await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-111",
      workItemId: "issue-111",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
      metadata: {
        issueNumber: "111",
      },
    });
    const claim = await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-111",
      laneRunId: "lane-run-111-a",
      claimedBy: "local-supervisor",
      claimedAt,
    });
    await completeLaneRunLock(stateRoot, {
      stableWorkItemId: "github-issue-111",
      laneRunId: claim.lock.laneRunId,
      completedAt: "2026-05-22T00:02:00.000Z",
      terminalStatus: "completed",
    });
    await writeFile(resolveLaneRunQueueRecordPath(stateRoot, "github-issue-111"), `${JSON.stringify(queued)}\n`, {
      encoding: "utf8",
    });

    const explanation = await explainLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-111",
    });

    assert.equal(explanation.laneState, "completed");
    assert.equal(explanation.verificationState, "succeeded");
    assert.equal(explanation.nextOperatorAction, "no action required");
  });
});

test("CLI status and explain emit deterministic public-safe JSON", async () => {
  await withStateRoot(async (stateRoot) => {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-111",
      workItemId: "issue-111",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
      metadata: {
        issueNumber: "111",
      },
    });

    const status = await execFileAsync(process.execPath, [
      "dist/src/cli/index.js",
      "status",
      "--state-root",
      stateRoot,
    ]);
    const explain = await execFileAsync(process.execPath, [
      "dist/src/cli/index.js",
      "explain",
      "--state-root",
      stateRoot,
      "--issue",
      "github-issue-111",
    ]);

    assert.equal(status.stderr, "");
    assert.equal(explain.stderr, "");
    assert.equal(JSON.stringify(JSON.parse(status.stdout)).includes(stateRoot), false);
    assert.equal(JSON.parse(explain.stdout).nextOperatorAction, "claim queued lane run when ready");
  });
});
