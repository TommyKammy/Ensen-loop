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

test("explain reports unknown requested issue separately from non-empty queue", async () => {
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

    const explanation = await explainLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
    });

    assert.equal(explanation.state, "blocked");
    assert.equal(explanation.selectedIssue, "github-issue-112");
    assert.equal(explanation.stableWorkItemId, "github-issue-112");
    assert.equal(explanation.laneState, "blocked");
    assert.equal(explanation.verificationState, "unknown");
    assert.equal(explanation.blockerReason, "requested issue is not queued");
    assert.equal(
      explanation.nextOperatorAction,
      "select an existing lane run or enqueue the requested issue before claiming readiness",
    );
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

test("CLI status exits blocked for queued blocker diagnostics", async () => {
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
        blockerReason: "required review evidence is missing",
      },
    });

    const result = await execCli(["status", "--state-root", stateRoot]);
    const status = JSON.parse(result.stdout) as { readonly state?: unknown; readonly blockerReason?: unknown };

    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 1);
    assert.equal(status.state, "blocked");
    assert.equal(status.blockerReason, "required review evidence is missing");
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

test("unsafe queue filenames are reported as malformed status and explanation", async () => {
  await withStateRoot(async (stateRoot) => {
    const queueRoot = path.join(stateRoot, "lane-run-queue");
    await mkdir(queueRoot, { recursive: true });
    await writeFile(path.join(queueRoot, "Github-Issue-111.json"), "{}\n", {
      encoding: "utf8",
    });

    const status = await getLaneRunStatus(stateRoot);
    const explanation = await explainLaneRun(stateRoot);

    assert.equal(status.state, "blocked");
    assert.equal(status.queue.length, 0);
    assert.equal(status.blockerReason, "lane run state is malformed");
    assert.equal(explanation.state, "blocked");
    assert.equal(explanation.blockerReason, "lane run state is malformed");
    assert.equal(explanation.nextOperatorAction, "repair or remove malformed lane state before continuing");
  });
});

test("non-regular queue JSON entries are reported as malformed status and explanation", async () => {
  await withStateRoot(async (stateRoot) => {
    const queueRoot = path.join(stateRoot, "lane-run-queue");
    await mkdir(path.join(queueRoot, "github-issue-111.json"), { recursive: true });

    const status = await getLaneRunStatus(stateRoot);
    const explanation = await explainLaneRun(stateRoot);

    assert.equal(status.state, "blocked");
    assert.equal(status.queue.length, 0);
    assert.equal(status.blockerReason, "lane run state is malformed");
    assert.equal(explanation.state, "blocked");
    assert.equal(explanation.blockerReason, "lane run state is malformed");
    assert.equal(explanation.nextOperatorAction, "repair or remove malformed lane state before continuing");
  });
});

test("queue filesystem shape errors are reported as malformed status and explanation", async () => {
  await withStateRoot(async (stateRoot) => {
    await writeFile(path.join(stateRoot, "lane-run-queue"), "not a directory\n", {
      encoding: "utf8",
    });

    const status = await getLaneRunStatus(stateRoot);
    const explanation = await explainLaneRun(stateRoot);

    assert.equal(status.state, "blocked");
    assert.equal(status.queue.length, 0);
    assert.equal(status.blockerReason, "lane run state is malformed");
    assert.equal(explanation.state, "blocked");
    assert.equal(explanation.blockerReason, "lane run state is malformed");
    assert.equal(explanation.nextOperatorAction, "repair or remove malformed lane state before continuing");
  });
});

test("state root filesystem shape errors are reported as malformed status and explanation", async () => {
  await withStateRoot(async (stateRoot) => {
    const stateRootFile = path.join(stateRoot, "state-root-file");
    await writeFile(stateRootFile, "not a directory\n", {
      encoding: "utf8",
    });
    const malformedStateRoot = path.join(stateRootFile, "child");

    const status = await getLaneRunStatus(malformedStateRoot);
    const explanation = await explainLaneRun(malformedStateRoot);

    assert.equal(status.state, "blocked");
    assert.equal(status.queue.length, 0);
    assert.equal(status.blockerReason, "lane run state is malformed");
    assert.equal(explanation.state, "blocked");
    assert.equal(explanation.blockerReason, "lane run state is malformed");
    assert.equal(explanation.nextOperatorAction, "repair or remove malformed lane state before continuing");
  });
});

test("CLI status returns structured blocked output for malformed queue shape", async () => {
  await withStateRoot(async (stateRoot) => {
    await writeFile(path.join(stateRoot, "lane-run-queue"), "not a directory\n", {
      encoding: "utf8",
    });

    const result = await execCli(["status", "--state-root", stateRoot]);
    const status = JSON.parse(result.stdout) as {
      readonly state?: unknown;
      readonly blockerReason?: unknown;
      readonly nextOperatorAction?: unknown;
    };

    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 1);
    assert.equal(status.state, "blocked");
    assert.equal(status.blockerReason, "lane run state is malformed");
    assert.equal(status.nextOperatorAction, "repair or remove malformed lane state before continuing");
  });
});

test("issue-scoped explain fails closed when any queue record is malformed", async () => {
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
    await writeFile(path.join(stateRoot, "lane-run-queue", "Github-Issue-112.json"), "{}\n", {
      encoding: "utf8",
    });

    const explanation = await explainLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-111",
    });

    assert.equal(explanation.state, "blocked");
    assert.equal(explanation.laneState, "blocked");
    assert.equal(explanation.blockerReason, "lane run state is malformed");
    assert.equal(explanation.nextOperatorAction, "repair or remove malformed lane state before continuing");
  });
});

test("invalid issue-scoped explain input is not reported as malformed state", async () => {
  await withStateRoot(async (stateRoot) => {
    await assert.rejects(
      () =>
        explainLaneRun(stateRoot, {
          stableWorkItemId: "Github-Issue-111",
        }),
      /Stable work item identifiers may only contain lowercase letters/,
    );
  });
});

test("status treats revoked and superseded queue states as blocked", async () => {
  for (const terminalStatus of ["revoked", "superseded"] as const) {
    await withStateRoot(async (stateRoot) => {
      await enqueueLaneRun(stateRoot, {
        stableWorkItemId: `github-issue-${terminalStatus}`,
        workItemId: `issue-${terminalStatus}`,
        source: "github-issue",
        laneId: "owner-dogfood",
        repositoryClassification: "owner-controlled-dogfood",
        queuedAt,
      });
      const claim = await claimQueuedLaneRun(stateRoot, {
        stableWorkItemId: `github-issue-${terminalStatus}`,
        laneRunId: `lane-run-${terminalStatus}-a`,
        claimedBy: "local-supervisor",
        claimedAt,
      });
      await completeLaneRunLock(stateRoot, {
        stableWorkItemId: `github-issue-${terminalStatus}`,
        laneRunId: claim.lock.laneRunId,
        completedAt: "2026-05-22T00:02:00.000Z",
        terminalStatus,
      });

      const status = await getLaneRunStatus(stateRoot);
      const explanation = await explainLaneRun(stateRoot, {
        stableWorkItemId: `github-issue-${terminalStatus}`,
      });

      assert.equal(status.state, "blocked");
      assert.equal(status.queue[0]?.laneState, terminalStatus);
      assert.equal(status.blockerReason, `lane run was ${terminalStatus}`);
      assert.equal(explanation.state, "blocked");
      assert.equal(explanation.laneState, terminalStatus);
    });
  }
});

test("status orders queue records by timestamp instant before stable id", async () => {
  await withStateRoot(async (stateRoot) => {
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-112",
      workItemId: "issue-112",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt: "2026-05-22T00:00:00Z",
      metadata: {
        issueNumber: "112",
      },
    });
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-111",
      workItemId: "issue-111",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt: "2026-05-22T00:30:00+01:00",
      metadata: {
        issueNumber: "111",
      },
    });

    const status = await getLaneRunStatus(stateRoot);
    const explanation = await explainLaneRun(stateRoot);

    assert.deepEqual(
      status.queue.map((item) => item.selectedIssue),
      ["#111", "#112"],
    );
    assert.equal(explanation.selectedIssue, "#111");
  });
});

test("explain without issue prefers blocked queue items over runnable work", async () => {
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
    await enqueueLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-111",
      workItemId: "issue-111",
      source: "github-issue",
      laneId: "owner-dogfood",
      repositoryClassification: "owner-controlled-dogfood",
      queuedAt: "2026-05-22T00:01:00.000Z",
      metadata: {
        issueNumber: "111",
        blockerReason: "required review evidence is missing",
      },
    });

    const status = await getLaneRunStatus(stateRoot);
    const explanation = await explainLaneRun(stateRoot);

    assert.equal(status.state, "blocked");
    assert.equal(explanation.state, "blocked");
    assert.equal(explanation.selectedIssue, "#111");
    assert.equal(explanation.laneState, "blocked");
    assert.equal(explanation.blockerReason, "required review evidence is missing");
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

test("operator projection ignores obsolete terminal lock for newer queued record", async () => {
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

    const status = await getLaneRunStatus(stateRoot);
    const explanation = await explainLaneRun(stateRoot, {
      stableWorkItemId: "github-issue-111",
    });

    assert.equal(status.state, "ok");
    assert.equal(status.queue[0]?.laneState, "queued");
    assert.equal(status.queue[0]?.verificationState, "not-started");
    assert.equal(status.queue[0]?.nextOperatorAction, "claim queued lane run when ready");
    assert.equal(status.queue[0]?.activeLock, undefined);
    assert.equal(explanation.laneState, "queued");
    assert.equal(explanation.verificationState, "not-started");
    assert.equal(explanation.nextOperatorAction, "claim queued lane run when ready");
    assert.equal(explanation.activeLock, undefined);
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
    const status = await getLaneRunStatus(stateRoot);

    assert.equal(status.queue[0]?.laneState, "completed");
    assert.equal(status.queue[0]?.verificationState, "succeeded");
    assert.equal(status.queue[0]?.nextOperatorAction, "no action required");
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

    const status = await execCli(["status", "--state-root", stateRoot]);
    const explain = await execCli(["explain", "--state-root", stateRoot, "--issue", "github-issue-111"]);

    assert.equal(status.stderr, "");
    assert.equal(explain.stderr, "");
    assert.equal(status.exitCode, 0);
    assert.equal(explain.exitCode, 0);
    assert.equal(JSON.stringify(JSON.parse(status.stdout)).includes(stateRoot), false);
    assert.equal(JSON.parse(explain.stdout).nextOperatorAction, "claim queued lane run when ready");
  });
});
