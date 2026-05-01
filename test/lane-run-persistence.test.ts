import assert from "node:assert/strict";
import { access, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createDeterministicLocalFakeExecutor,
  invokeLaneExecutor,
  persistLaneExecutorResult,
} from "../src/executor/index.js";
import {
  prepareLocalLaneWorkspace,
  readLaneRunState,
  resolveLaneRunStatePath,
} from "../src/lane/index.js";
import {
  createRunRequestExecutionPlan,
  parseRunRequest,
  validateEvidenceBundleRef,
} from "../src/protocol/index.js";

const request = parseRunRequest({
  schemaVersion: "eip.run-request.v1",
  id: "req_01HV7Y8M8F2KQ5W3P9R6T4N2BA",
  correlationId: "corr_01HV7Y8M8F2KQ5W3P9R6T4N2BB",
  idempotencyKey: "issue-41-test-key-001",
  source: {
    sourceId: "source_01HV7Y8M8F2KQ5W3P9R6T4N2BC",
    sourceType: "github-issue",
  },
  requestedBy: {
    actorId: "actor_01HV7Y8M8F2KQ5W3P9R6T4N2BD",
    actorType: "workflow",
  },
  workItem: {
    workItemId: "workitem_01HV7Y8M8F2KQ5W3P9R6T4N2BE",
    externalId: "41",
    title: "Persist Phase 3 lane journal and evidence references",
  },
  mode: "plan",
  createdAt: "2026-05-01T00:00:00Z",
  target: {
    targetType: "repository",
    targetId: "repo_01HV7Y8M8F2KQ5W3P9R6T4N2BF",
  },
  policyContext: {
    policySetId: "policy_01HV7Y8M8F2KQ5W3P9R6T4N2BG",
    riskClasses: [],
    requiresApproval: false,
  },
});

async function withPersistedFixture(
  fixture: Parameters<typeof invokeLaneExecutor>[0]["fixture"],
  callback: (context: {
    readonly stateRoot: string;
    readonly preparedContext: {
      readonly laneRunId: string;
      readonly workspacePath: string;
      readonly statePath: string;
    };
    readonly persisted: Awaited<ReturnType<typeof persistLaneExecutorResult>>;
  }) => Promise<void>,
): Promise<void> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-workspace-"));
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));
  const laneRunId = "run_01HV7Y8M8F2KQ5W3P9R6T4N2BA";
  const plan = createRunRequestExecutionPlan(request);

  try {
    const preparedContext = await prepareLocalLaneWorkspace({
      workspaceRoot,
      stateRoot,
      laneRunId,
      workItemId: request.workItem.workItemId,
    });
    const executorContext = {
      laneRunId,
      workspacePath: preparedContext.workspacePath,
      statePath: preparedContext.statePath,
    };
    const executorResult = await invokeLaneExecutor({
      executor: createDeterministicLocalFakeExecutor(),
      mode: "deterministic-local-fake",
      plan,
      preparedContext: executorContext,
      completedAt: "2026-05-01T00:00:01Z",
      fixture,
    });

    const persisted = await persistLaneExecutorResult({
      stateRoot,
      plan,
      preparedContext: executorContext,
      executorResult,
      recordedAt: "2026-05-01T00:00:02Z",
    });

    await callback({ stateRoot, preparedContext: executorContext, persisted });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
}

test("persists a succeeded Phase 3 lane journal and local evidence metadata for restart readback", async () => {
  await withPersistedFixture(
    {
      name: "issue-41-succeeded",
      outcome: "succeeded",
      verificationSummary: "sanitized issue 41 success",
    },
    async ({ stateRoot, persisted }) => {
      assert.equal(persisted.state.status, "completed");
      assert.equal(persisted.state.evidence.bundleRefs.length, 1);
      assert.equal(validateEvidenceBundleRef(persisted.evidenceBundleRefs[0]).ok, true);
      assert.deepEqual(persisted.state.evidence.bundleRefs, [
        persisted.evidenceBundleRefs[0].uri,
      ]);

      const metadata = JSON.parse(await readFile(persisted.evidenceMetadataPaths[0], "utf8")) as {
        outcome: string;
        laneRunId: string;
        evidenceBundleRef: { uri: string };
      };
      assert.equal(metadata.outcome, "succeeded");
      assert.equal(metadata.laneRunId, persisted.state.id);
      assert.equal(metadata.evidenceBundleRef.uri, persisted.evidenceBundleRefs[0].uri);

      const readBack = await readLaneRunState(stateRoot, persisted.state.id);
      assert.deepEqual(readBack, persisted.state);
      assert.match(
        readBack.journal.entries.map((entry) => entry.message).join("\n"),
        /prepared workspace facts recorded/,
      );
      const serialized = JSON.stringify({
        state: persisted.state,
        evidenceBundleRefs: persisted.evidenceBundleRefs,
        metadata,
      });
      assert.equal(serialized.includes(os.tmpdir()), false);
    },
  );
});

test("preserves existing lane state when a retry fails on existing evidence metadata", async () => {
  await withPersistedFixture(
    {
      name: "issue-50-retry-existing-metadata",
      outcome: "succeeded",
      verificationSummary: "sanitized issue 50 initial success",
    },
    async ({ stateRoot, preparedContext, persisted }) => {
      const originalStateFile = await readFile(persisted.statePath, "utf8");
      const originalMetadataFile = await readFile(persisted.evidenceMetadataPaths[0], "utf8");
      const plan = createRunRequestExecutionPlan(request);
      const executorResult = await invokeLaneExecutor({
        executor: createDeterministicLocalFakeExecutor(),
        mode: "deterministic-local-fake",
        plan,
        preparedContext,
        completedAt: "2026-05-01T00:00:07Z",
        fixture: {
          name: "issue-50-retry-existing-metadata",
          outcome: "succeeded",
          verificationSummary: "sanitized issue 50 retry",
        },
      });

      await assert.rejects(
        () =>
          persistLaneExecutorResult({
            stateRoot,
            plan,
            preparedContext,
            executorResult,
            recordedAt: "2026-05-01T00:00:08Z",
          }),
        /EEXIST/,
      );

      assert.equal(await readFile(persisted.statePath, "utf8"), originalStateFile);
      assert.equal(await readFile(persisted.evidenceMetadataPaths[0], "utf8"), originalMetadataFile);
      assert.deepEqual(await readLaneRunState(stateRoot, persisted.state.id), persisted.state);
    },
  );
});

test("rejects executor results that do not belong to the prepared lane", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-workspace-"));
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));
  const laneRunId = "run_01HV7Y8M8F2KQ5W3P9R6T4N2BA";
  const plan = createRunRequestExecutionPlan(request);

  try {
    const preparedContext = await prepareLocalLaneWorkspace({
      workspaceRoot,
      stateRoot,
      laneRunId,
      workItemId: request.workItem.workItemId,
    });
    const executorContext = {
      laneRunId,
      workspacePath: preparedContext.workspacePath,
      statePath: preparedContext.statePath,
    };
    const executorResult = await invokeLaneExecutor({
      executor: createDeterministicLocalFakeExecutor(),
      mode: "deterministic-local-fake",
      plan,
      preparedContext: executorContext,
      completedAt: "2026-05-01T00:00:02Z",
      fixture: {
        name: "issue-41-mismatched-result",
        outcome: "succeeded",
      },
    });

    await assert.rejects(
      () =>
        persistLaneExecutorResult({
          stateRoot,
          plan,
          preparedContext: executorContext,
          executorResult: {
            ...executorResult,
            invocation: {
              ...executorResult.invocation,
              laneRunId: "run_01HV7Y8M8F2KQ5W3P9R6T4N2ZZ",
            },
          },
          recordedAt: "2026-05-01T00:00:03Z",
        }),
      /Executor result lane run identifier does not match the prepared context/,
    );
    await assert.rejects(() => readLaneRunState(stateRoot, laneRunId), /ENOENT/);
    await assert.rejects(
      () => access(path.join(preparedContext.statePath, "artifacts")),
      /ENOENT/,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("persists failed and blocked Phase 3 outcomes with diagnostic journal entries", async () => {
  await withPersistedFixture(
    {
      name: "issue-41-failed",
      outcome: "failed",
      verificationSummary: "sanitized issue 41 failure",
    },
    async ({ persisted }) => {
      assert.equal(persisted.state.status, "failed");
      assert.match(
        persisted.state.journal.entries.map((entry) => entry.message).join("\n"),
        /executor outcome: failed/,
      );
    },
  );

  await withPersistedFixture(
    {
      name: "issue-41-blocked",
      outcome: "blocked",
      blockedReasons: ["missing prepared verification evidence"],
    },
    async ({ persisted }) => {
      assert.equal(persisted.state.status, "blocked");
      assert.match(
        persisted.state.journal.entries.map((entry) => entry.message).join("\n"),
        /missing prepared verification evidence/,
      );
    },
  );
});

test("rejects unsafe EvidenceBundleRef output before writing evidence metadata or lane state", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-workspace-"));
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));
  const laneRunId = "run_01HV7Y8M8F2KQ5W3P9R6T4N2BA";
  const plan = createRunRequestExecutionPlan(request);

  try {
    const preparedContext = await prepareLocalLaneWorkspace({
      workspaceRoot,
      stateRoot,
      laneRunId,
      workItemId: request.workItem.workItemId,
    });
    const executorContext = {
      laneRunId,
      workspacePath: preparedContext.workspacePath,
      statePath: preparedContext.statePath,
    };
    const executorResult = await invokeLaneExecutor({
      executor: createDeterministicLocalFakeExecutor(),
      mode: "deterministic-local-fake",
      plan,
      preparedContext: executorContext,
      completedAt: "2026-05-01T00:00:03Z",
      fixture: {
        name: "issue-41-unsafe-ref",
        outcome: "succeeded",
      },
    });

    await assert.rejects(
      () =>
        persistLaneExecutorResult({
          stateRoot,
          plan,
          preparedContext: executorContext,
          executorResult,
          recordedAt: "2026-05-01T00:00:04Z",
          evidenceBundleRefs: [
            {
              schemaVersion: "eip.evidence-bundle-ref.v1",
              id: "evb_01HV7Y8M8F2KQ5W3P9R6T4N2BH",
              correlationId: request.correlationId,
              type: "local_path",
              uri: "../unsafe/bundle.json",
              createdAt: "2026-05-01T00:00:04Z",
            },
          ],
        }),
      /EvidenceBundleRef output is unsafe/,
    );
    await assert.rejects(() => readLaneRunState(stateRoot, laneRunId), /ENOENT/);
    await assert.rejects(
      () => access(path.join(preparedContext.statePath, "artifacts")),
      /ENOENT/,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("cleans evidence metadata and lane-state path when persistence fails", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-workspace-"));
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-outside-"));
  const laneRunId = "run_01HV7Y8M8F2KQ5W3P9R6T4N2BA";
  const plan = createRunRequestExecutionPlan(request);

  try {
    const preparedContext = await prepareLocalLaneWorkspace({
      workspaceRoot,
      stateRoot,
      laneRunId,
      workItemId: request.workItem.workItemId,
    });
    const executorContext = {
      laneRunId,
      workspacePath: preparedContext.workspacePath,
      statePath: preparedContext.statePath,
    };
    const executorResult = await invokeLaneExecutor({
      executor: createDeterministicLocalFakeExecutor(),
      mode: "deterministic-local-fake",
      plan,
      preparedContext: executorContext,
      completedAt: "2026-05-01T00:00:05Z",
      fixture: {
        name: "issue-41-cleanup-failure",
        outcome: "succeeded",
      },
    });
    const statePath = resolveLaneRunStatePath(stateRoot, laneRunId);
    const outsideStatePath = path.join(outsideRoot, "outside-lane-state.json");
    const evidenceMetadataPath = path.join(
      preparedContext.statePath,
      "artifacts",
      "evidence",
      "local-lane",
      `${laneRunId}.json`,
    );

    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(outsideStatePath, "outside state must not be touched\n", "utf8");
    await symlink(outsideStatePath, statePath);

    await assert.rejects(
      () =>
        persistLaneExecutorResult({
          stateRoot,
          plan,
          preparedContext: executorContext,
          executorResult,
          recordedAt: "2026-05-01T00:00:06Z",
        }),
      /Lane run state paths must not traverse symbolic links/,
    );

    assert.equal((await lstat(statePath)).isSymbolicLink(), true);
    await assert.rejects(() => access(evidenceMetadataPath), /ENOENT/);
    assert.equal(await readFile(outsideStatePath, "utf8"), "outside state must not be touched\n");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});
