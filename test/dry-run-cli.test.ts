import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("dry-run sample emits a normalized execution plan", async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    "dist/src/cli/index.js",
    "dry-run",
    "--sample",
  ]);

  assert.equal(stderr, "");

  const plan = JSON.parse(stdout) as {
    command: string;
    mode: string;
    workItem: {
      id: string;
      title: string;
      source: string;
      status: string;
    };
    laneWorkspace: {
      intent: string;
      mutatesFilesystem: boolean;
    };
    agentProvider: {
      intent: string;
      invokesProvider: boolean;
    };
    scmProvider: {
      intent: string;
      createsBranch: boolean;
      opensChangeRequest: boolean;
    };
    verification: {
      intent: string;
      commands: readonly string[];
    };
    evidence: {
      intent: string;
      writesDurableEvidence: boolean;
      bundleRefs: readonly unknown[];
    };
  };

  assert.equal(plan.command, "dry-run");
  assert.equal(plan.mode, "sample");
  assert.deepEqual(plan.workItem, {
    id: "sample-local-work-item",
    title: "Sample local work item",
    source: "local-sample",
    status: "ready",
  });
  assert.deepEqual(plan.laneWorkspace, {
    intent: "describe lane workspace preparation without creating a worktree",
    mutatesFilesystem: false,
  });
  assert.deepEqual(plan.agentProvider, {
    intent: "describe agent selection without invoking an agent provider",
    invokesProvider: false,
  });
  assert.deepEqual(plan.scmProvider, {
    intent: "describe SCM actions without creating branches, commits, or change requests",
    createsBranch: false,
    opensChangeRequest: false,
  });
  assert.deepEqual(plan.verification, {
    intent: "describe repo-owned verification commands without running them",
    commands: ["npm run build", "npm test"],
  });
  assert.deepEqual(plan.evidence, {
    intent:
      "describe validation-ready evidence metadata without writing a full evidence bundle artifact",
    writesDurableEvidence: false,
    bundleRefs: [
      {
        schemaVersion: "eip.evidence-bundle-ref.v1",
        id: "evb_sampleDryRunEvidenceRef01",
        correlationId: "corr_sampleDryRunEvidenceRef01",
        type: "local_path",
        uri: "artifacts/evidence/dry-run/sample-bundle.json",
        createdAt: "2026-04-29T00:00:00Z",
        contentType: "application/json",
        metadata: {
          producer: "ensen-loop",
          artifactKind: "validationReadyEvidenceMetadata",
          writesDurableEvidence: false,
        },
      },
    ],
  });
});
