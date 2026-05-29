import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  claimQueuedLaneRun,
  enqueueLaneRun,
  planLoopMode,
} from "../src/lane/index.js";

const execFileAsync = promisify(execFile);
const queuedAt = "2026-05-29T10:00:00.000Z";
const claimedAt = "2026-05-29T10:01:00.000Z";

interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

async function withStateRoot(callback: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    await callback(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

async function execCli(args: readonly string[]): Promise<CliResult> {
  try {
    const result = await execFileAsync(process.execPath, ["dist/src/cli/index.js", ...args]);

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    };
  } catch (error) {
    if (isCliExitError(error)) {
      return {
        stdout: error.stdout,
        stderr: error.stderr,
        exitCode: error.code,
      };
    }

    throw error;
  }
}

function isCliExitError(error: unknown): error is Error & { readonly code: number; readonly stdout: string; readonly stderr: string } {
  return (
    error instanceof Error &&
    typeof (error as { readonly code?: unknown }).code === "number" &&
    typeof (error as { readonly stdout?: unknown }).stdout === "string" &&
    typeof (error as { readonly stderr?: unknown }).stderr === "string"
  );
}

test("plans one-shot mode for exactly one selected queued issue", async () => {
  await withStateRoot(async (stateRoot) => {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-114",
      workItemId: "issue-114",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
      metadata: {
        issueNumber: "114",
      },
    });

    const plan = await planLoopMode(stateRoot, {
      mode: "one-shot",
      stableWorkItemId: "github-issue-114",
      invokedBy: "operator",
    });

    assert.deepEqual(plan, {
      schemaVersion: "ensen.loop-mode-plan.v1",
      mode: "one-shot",
      state: "ready",
      selectedIssue: "#114",
      stableWorkItemId: "github-issue-114",
      selection: {
        strategy: "operator-selected",
        maxSelections: 1,
        repeats: false,
      },
      safetyGates: {
        ownerControlledOnly: true,
        customerRepoExecution: false,
        regulatedDataHandling: false,
        automaticMerge: false,
        automaticQualityDecision: false,
      },
      sharedBoundaries: [
        "queue",
        "lock",
        "status",
        "explain",
        "stop",
        "retry",
        "requeue",
        "stale-state-reconciliation",
      ],
      nextOperatorAction: "claim queued lane run when ready",
    });
    assert.equal(JSON.stringify(plan).includes(stateRoot), false);
  });
});

test("plans continuous mode as repeated supervised selection without auto merge or quality decisions", async () => {
  await withStateRoot(async (stateRoot) => {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-114",
      workItemId: "issue-114",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
      metadata: {
        issueNumber: "114",
      },
    });

    const plan = await planLoopMode(stateRoot, {
      mode: "continuous",
      invokedBy: "operator",
    });

    assert.equal(plan.state, "ready");
    assert.equal(plan.mode, "continuous");
    assert.equal(plan.selectedIssue, "#114");
    assert.deepEqual(plan.selection, {
      strategy: "supervised-repeated-selection",
      maxSelections: 1,
      repeats: true,
    });
    assert.equal(plan.safetyGates.automaticMerge, false);
    assert.equal(plan.safetyGates.automaticQualityDecision, false);
    assert.equal(plan.safetyGates.customerRepoExecution, false);
    assert.equal(plan.safetyGates.regulatedDataHandling, false);
    assert.equal(plan.nextOperatorAction, "claim queued lane run when ready");
  });
});

test("blocks continuous mode when the selected queue item is already locked", async () => {
  await withStateRoot(async (stateRoot) => {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-114",
      workItemId: "issue-114",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
      metadata: {
        issueNumber: "114",
      },
    });
    await claimQueuedLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-114",
      laneRunId: "lane-run-114-a",
      claimedBy: "operator-token=ghp_sampleSecretValue",
      claimedAt,
    });

    const plan = await planLoopMode(stateRoot, {
      mode: "continuous",
      invokedBy: "operator-token=ghp_sampleSecretValue",
    });

    assert.equal(plan.state, "blocked");
    assert.equal(plan.blockerReason, "lane run is already active");
    assert.equal(plan.nextOperatorAction, "wait for active lane run lane-run-114-a to finish");
    assert.equal(JSON.stringify(plan).includes("ghp_sampleSecretValue"), false);
  });
});

test("CLI loop-mode emits public-safe diagnostics and X-Gate 4 owner-only wording", async () => {
  await withStateRoot(async (stateRoot) => {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-114",
      workItemId: "issue-114",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt,
      metadata: {
        issueNumber: "114",
      },
    });

    const result = await execCli(["loop-mode", "continuous", "--state-root", stateRoot]);
    const plan = JSON.parse(result.stdout) as {
      readonly state?: unknown;
      readonly xGate4DogfoodBoundary?: unknown;
    };

    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(plan.state, "ready");
    assert.equal(
      plan.xGate4DogfoodBoundary,
      "owner-controlled repos only; does not authorize customer repo execution",
    );
    assert.equal(JSON.stringify(plan).includes(stateRoot), false);
  });
});
