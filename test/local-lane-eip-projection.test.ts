import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createDeterministicLocalFakeExecutor,
  invokeLaneExecutor,
  persistLaneExecutorResult,
} from "../src/executor/index.js";
import {
  type LaneRunState,
  prepareLocalLaneWorkspace,
} from "../src/lane/index.js";
import {
  createRunRequestExecutionPlan,
  parseRunRequest,
  projectLaneRunResult,
  projectLaneRunStatusSnapshot,
  validateRunResult,
  validateRunStatusSnapshot,
} from "../src/protocol/index.js";

const fixtureRoot = path.join(
  "protocol-snapshots",
  "ensen-protocol",
  "v0.2.0",
  "fixtures",
);

async function readJson(relativePath: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(fixtureRoot, relativePath), "utf8")) as unknown;
}

async function withPersistedLaneRun(
  fixture: {
    readonly name: string;
    readonly outcome: "succeeded" | "failed" | "blocked";
    readonly verificationSummary?: string;
    readonly blockedReasons?: readonly string[];
  },
  callback: (context: Awaited<ReturnType<typeof createPersistedLaneRun>>) => Promise<void>,
): Promise<void> {
  const context = await createPersistedLaneRun(fixture);

  try {
    await callback(context);
  } finally {
    await rm(context.workspaceRoot, { recursive: true, force: true });
    await rm(context.stateRoot, { recursive: true, force: true });
  }
}

async function createPersistedLaneRun(fixture: {
  readonly name: string;
  readonly outcome: "succeeded" | "failed" | "blocked";
  readonly verificationSummary?: string;
  readonly blockedReasons?: readonly string[];
}) {
  const request = parseRunRequest(await readJson("run-request/v1/valid/github-issue-request.json"));
  const plan = createRunRequestExecutionPlan(request);
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-projection-workspace-"));
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-projection-state-"));
  const laneRunId = "run_01HV7Y8M8F2KQ5W3P9R6T4N2AB";
  const prepared = await prepareLocalLaneWorkspace({
    workspaceRoot,
    stateRoot,
    laneRunId,
    workItemId: request.workItem.workItemId,
  });
  const preparedContext = {
    laneRunId,
    workspacePath: prepared.workspacePath,
    statePath: prepared.statePath,
  };
  const executorResult = await invokeLaneExecutor({
    executor: createDeterministicLocalFakeExecutor(),
    mode: "deterministic-local-fake",
    plan,
    preparedContext,
    completedAt: "2026-05-01T00:00:01Z",
    fixture,
  });
  const persisted = await persistLaneExecutorResult({
    stateRoot,
    plan,
    preparedContext,
    executorResult,
    recordedAt: "2026-05-01T00:00:02Z",
  });

  return {
    request,
    persisted,
    stateRoot,
    workspaceRoot,
  };
}

test("projects persisted completed lane state to EIP status and succeeded result output", async () => {
  await withPersistedLaneRun(
    {
      name: "issue-42-succeeded",
      outcome: "succeeded",
      verificationSummary: "issue 42 projection verification passed",
    },
    async ({ request, persisted }) => {
      const succeededFixture = await readJson("run-result/v1/valid/succeeded-result.json") as {
        schemaVersion: string;
        status: string;
      };
      const snapshot = projectLaneRunStatusSnapshot({
        state: persisted.state,
        requestId: request.id,
        correlationId: request.correlationId,
        observedAt: "2026-05-01T00:00:03Z",
      });
      const result = projectLaneRunResult({
        state: persisted.state,
        requestId: request.id,
        correlationId: request.correlationId,
        completedAt: "2026-05-01T00:00:03Z",
        evidenceBundleRefs: persisted.evidenceBundleRefs,
      });

      assert.equal(validateRunStatusSnapshot(snapshot).ok, true);
      assert.equal(snapshot.status, "completed");
      assert.equal(snapshot.runId, persisted.state.id);
      assert.equal(validateRunResult(result).ok, true);
      assert.equal(result.schemaVersion, succeededFixture.schemaVersion);
      assert.equal(result.status, succeededFixture.status);
      assert.deepEqual(result.evidenceBundles, [
        {
          evidenceBundleId: persisted.evidenceBundleRefs[0].id,
        },
      ]);
    },
  );
});

test("requires explicit Track B customer lane evidence classification before RunResult projection", async () => {
  await withPersistedLaneRun(
    {
      name: "issue-42-succeeded",
      outcome: "succeeded",
    },
    async ({ request, persisted }) => {
      const trackBRef = {
        ...persisted.evidenceBundleRefs[0],
        metadata: {
          ...persisted.evidenceBundleRefs[0].metadata,
          evidenceTrack: "track-b",
          evidenceBoundary: "customer-lane",
          dataClassification: "regulated",
          referenceKind: "controlledEvidenceReference",
          embedsEvidencePayload: false,
        },
      };

      assert.doesNotThrow(() =>
        projectLaneRunResult({
          state: persisted.state,
          requestId: request.id,
          correlationId: request.correlationId,
          completedAt: "2026-05-01T00:00:03Z",
          evidenceBundleRefs: [trackBRef],
        }),
      );

      const missingClassificationMetadata: Record<string, string | number | boolean | null> = {
        ...trackBRef.metadata,
      };
      delete missingClassificationMetadata.dataClassification;

      assert.throws(
        () =>
          projectLaneRunResult({
            state: persisted.state,
            requestId: request.id,
            correlationId: request.correlationId,
            completedAt: "2026-05-01T00:00:03Z",
            evidenceBundleRefs: [
              {
                ...trackBRef,
                metadata: missingClassificationMetadata,
              },
            ],
          }),
        /Track B customer lane evidence requires an explicit allowed data classification/i,
      );

      assert.throws(
        () =>
          projectLaneRunResult({
            state: persisted.state,
            requestId: request.id,
            correlationId: request.correlationId,
            completedAt: "2026-05-01T00:00:03Z",
            evidenceBundleRefs: [
              {
                ...trackBRef,
                metadata: {
                  ...trackBRef.metadata,
                  dataClassification: "unknown",
                },
              },
            ],
          }),
        /Track B customer lane evidence requires an explicit allowed data classification/i,
      );

      assert.throws(
        () =>
          projectLaneRunResult({
            state: persisted.state,
            requestId: request.id,
            correlationId: request.correlationId,
            completedAt: "2026-05-01T00:00:03Z",
            evidenceBundleRefs: [
              {
                ...persisted.evidenceBundleRefs[0],
                metadata: {
                  ...persisted.evidenceBundleRefs[0].metadata,
                  dataClassification: "regulated",
                  embedsEvidencePayload: false,
                  rawCustomerRecord: "synthetic customer record",
                },
              },
            ],
          }),
        /Track B customer lane evidence references must not embed raw controlled material/i,
      );

      assert.throws(
        () =>
          projectLaneRunResult({
            state: persisted.state,
            requestId: request.id,
            correlationId: request.correlationId,
            completedAt: "2026-05-01T00:00:03Z",
            evidenceBundleRefs: [
              {
                ...persisted.evidenceBundleRefs[0],
                metadata: {
                  ...persisted.evidenceBundleRefs[0].metadata,
                  dataClassification: "internal",
                  controlledReference: true,
                  embedsEvidencePayload: false,
                  rawCustomerRecord: "synthetic customer record",
                },
              },
            ],
          }),
        /Track B customer lane evidence references must not embed raw controlled material/i,
      );
    },
  );
});

test("projects failed and blocked terminal lane state without inventing success evidence", async () => {
  await withPersistedLaneRun(
    {
      name: "issue-42-failed",
      outcome: "failed",
      verificationSummary: "issue 42 verification failed",
    },
    async ({ request, persisted }) => {
      const result = projectLaneRunResult({
        state: persisted.state,
        requestId: request.id,
        correlationId: request.correlationId,
        completedAt: "2026-05-01T00:00:03Z",
        evidenceBundleRefs: persisted.evidenceBundleRefs,
      });

      assert.equal(validateRunResult(result).ok, true);
      assert.equal(result.status, "failed");
      assert.equal(result.evidenceBundles, undefined);
      assert.equal(result.errors?.[0]?.code, "LOCAL_LANE_FAILED");
    },
  );

  await withPersistedLaneRun(
    {
      name: "issue-42-blocked",
      outcome: "blocked",
      blockedReasons: ["required verification evidence is missing"],
    },
    async ({ request, persisted }) => {
      const result = projectLaneRunResult({
        state: persisted.state,
        requestId: request.id,
        correlationId: request.correlationId,
        completedAt: "2026-05-01T00:00:03Z",
        evidenceBundleRefs: persisted.evidenceBundleRefs,
      });

      assert.equal(validateRunResult(result).ok, true);
      assert.equal(result.status, "blocked");
      assert.equal(result.evidenceBundles, undefined);
      assert.match(result.verification?.summary ?? "", /required verification evidence/);
      assert.equal(result.warnings?.[0]?.code, "LOCAL_LANE_BLOCKED");
    },
  );
});

test("projects in-progress lane state to status snapshots but not final results", async () => {
  await withPersistedLaneRun(
    {
      name: "issue-42-succeeded",
      outcome: "succeeded",
    },
    async ({ request, persisted }) => {
      const runningState: LaneRunState = {
        ...persisted.state,
        status: "verifying",
        evidence: {
          bundleRefs: [],
        },
      };
      const snapshot = projectLaneRunStatusSnapshot({
        state: runningState,
        requestId: request.id,
        correlationId: request.correlationId,
        observedAt: "2026-05-01T00:00:03Z",
      });

      assert.equal(validateRunStatusSnapshot(snapshot).ok, true);
      assert.equal(snapshot.status, "running");
      assert.deepEqual(snapshot.progress, {
        current: 2,
        total: 3,
        percent: 67,
        unit: "local-lane-stages",
      });
      assert.throws(
        () =>
          projectLaneRunResult({
            state: runningState,
            requestId: request.id,
            correlationId: request.correlationId,
            completedAt: "2026-05-01T00:00:03Z",
          }),
        /until it is terminal/,
      );
    },
  );
});

test("fails closed for stale evidence, unsupported versions, and malformed state", async () => {
  await withPersistedLaneRun(
    {
      name: "issue-42-succeeded",
      outcome: "succeeded",
    },
    async ({ request, persisted }) => {
      assert.throws(
        () =>
          projectLaneRunResult({
            state: persisted.state,
            requestId: request.id,
            correlationId: request.correlationId,
            completedAt: "2026-05-01T00:00:03Z",
            evidenceBundleRefs: [],
          }),
        /without a matching EvidenceBundleRef/,
      );
      assert.throws(
        () =>
          projectLaneRunStatusSnapshot({
            state: persisted.state,
            requestId: request.id,
            correlationId: request.correlationId,
            observedAt: "2026-05-01T00:00:03Z",
            protocolSchemaVersion: "eip.run-status.v2",
          }),
        /Unsupported EIP schema version/,
      );
      assert.throws(
        () =>
          projectLaneRunStatusSnapshot({
            state: {
              ...persisted.state,
              journal: {
                ...persisted.state.journal,
                laneRunId: "run_01HV7Y8M8F2KQ5W3P9R6T4N2ZZ",
              },
            },
            requestId: request.id,
            correlationId: request.correlationId,
            observedAt: "2026-05-01T00:00:03Z",
          }),
        /malformed/,
      );
    },
  );
});
