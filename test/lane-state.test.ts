import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createLaneJournal,
  createLaneRunState,
  readLaneRunState,
  resolveLaneRunStatePath,
  serializeLaneRunState,
  writeLaneRunState,
} from "../src/lane/index.js";

test("serializes lane journal and durable state without starting execution", () => {
  const journal = createLaneJournal({
    id: "journal-1",
    laneRunId: "lane-run-1",
    workItemId: "work-item-1",
    entries: [
      {
        id: "entry-1",
        recordedAt: "2026-04-29T09:00:00.000Z",
        kind: "hypothesis",
        message: "Add a durable state skeleton before agent execution exists.",
      },
    ],
  });

  const state = createLaneRunState({
    id: "lane-run-1",
    workItemId: "work-item-1",
    status: "queued",
    revision: 1,
    createdAt: "2026-04-29T09:00:00.000Z",
    updatedAt: "2026-04-29T09:00:00.000Z",
    journal,
    audit: {
      eventRefs: [],
    },
    evidence: {
      bundleRefs: [],
    },
  });

  assert.equal(state.startsAgentExecution, false);
  assert.deepEqual(JSON.parse(serializeLaneRunState(state)), {
    id: "lane-run-1",
    workItemId: "work-item-1",
    status: "queued",
    revision: 1,
    createdAt: "2026-04-29T09:00:00.000Z",
    updatedAt: "2026-04-29T09:00:00.000Z",
    startsAgentExecution: false,
    journal,
    audit: {
      eventRefs: [],
    },
    evidence: {
      bundleRefs: [],
    },
  });
});

test("persists lane run state below the configured state root", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    const state = createLaneRunState({
      id: "lane-run-2",
      workItemId: "work-item-2",
      status: "running",
      revision: 2,
      createdAt: "2026-04-29T09:00:00.000Z",
      updatedAt: "2026-04-29T09:05:00.000Z",
      journal: createLaneJournal({
        id: "journal-2",
        laneRunId: "lane-run-2",
        workItemId: "work-item-2",
        entries: [],
      }),
      audit: {
        eventRefs: ["audit-placeholder"],
      },
      evidence: {
        bundleRefs: ["evidence-placeholder"],
      },
    });

    const statePath = await writeLaneRunState(stateRoot, state);

    assert.equal(statePath, resolveLaneRunStatePath(stateRoot, state.id));
    assert.equal(path.dirname(statePath), path.join(path.resolve(stateRoot), "lane-runs"));
    assert.equal(await readFile(statePath, "utf8"), `${serializeLaneRunState(state)}\n`);
    assert.deepEqual(await readLaneRunState(stateRoot, state.id), state);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("validates lane run state before persisting", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    const invalidRevisionState = {
      ...createTestLaneRunState("invalid-write-revision"),
      revision: 0,
    } as ReturnType<typeof createTestLaneRunState>;
    const invalidRevisionPath = resolveLaneRunStatePath(stateRoot, invalidRevisionState.id);

    await assert.rejects(
      () => writeLaneRunState(stateRoot, invalidRevisionState),
      /Lane run state is malformed/,
    );
    await assert.rejects(() => readFile(invalidRevisionPath, "utf8"), /ENOENT/);

    const mismatchedJournalState = {
      ...createTestLaneRunState("invalid-write-journal"),
      journal: createLaneJournal({
        id: "journal-invalid-write-journal",
        laneRunId: "different-lane-run",
        workItemId: "work-item-invalid-write-journal",
        entries: [],
      }),
    } as ReturnType<typeof createTestLaneRunState>;
    const mismatchedJournalPath = resolveLaneRunStatePath(stateRoot, mismatchedJournalState.id);

    await assert.rejects(
      () => writeLaneRunState(stateRoot, mismatchedJournalState),
      /Lane run state identifiers do not match the lane run being persisted/,
    );
    await assert.rejects(() => readFile(mismatchedJournalPath, "utf8"), /ENOENT/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("rejects lane run state access through symlinked storage paths", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-outside-state-"));

  try {
    await symlink(outsideRoot, path.join(stateRoot, "lane-runs"), "dir");

    const state = createTestLaneRunState("symlink-escape-run");
    const outsideStatePath = path.join(outsideRoot, `${state.id}.json`);
    await writeFile(outsideStatePath, `${serializeLaneRunState(state)}\n`, "utf8");

    await assert.rejects(
      () => writeLaneRunState(stateRoot, state),
      /symbolic links/,
    );
    await assert.rejects(
      () => readLaneRunState(stateRoot, state.id),
      /symbolic links/,
    );
    assert.equal(await readFile(outsideStatePath, "utf8"), `${serializeLaneRunState(state)}\n`);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("rejects durable lane run state that does not match the requested run", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    const statePath = resolveLaneRunStatePath(stateRoot, "requested-run");
    const copiedState = createLaneRunState({
      id: "copied-run",
      workItemId: "work-item-copied",
      status: "queued",
      revision: 1,
      createdAt: "2026-04-29T09:00:00.000Z",
      updatedAt: "2026-04-29T09:00:00.000Z",
      journal: createLaneJournal({
        id: "journal-copied",
        laneRunId: "copied-run",
        workItemId: "work-item-copied",
        entries: [],
      }),
    });

    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, serializeLaneRunState(copiedState), "utf8");

    await assert.rejects(
      () => readLaneRunState(stateRoot, "requested-run"),
      /Lane run state identifiers do not match the requested lane run/,
    );

    const workItemMismatchPath = resolveLaneRunStatePath(stateRoot, "work-item-mismatch-run");
    const workItemMismatchState = createLaneRunState({
      id: "work-item-mismatch-run",
      workItemId: "work-item-state",
      status: "queued",
      revision: 1,
      createdAt: "2026-04-29T09:00:00.000Z",
      updatedAt: "2026-04-29T09:00:00.000Z",
      journal: createLaneJournal({
        id: "journal-work-item-mismatch",
        laneRunId: "work-item-mismatch-run",
        workItemId: "work-item-journal",
        entries: [],
      }),
    });

    await writeFile(workItemMismatchPath, serializeLaneRunState(workItemMismatchState), "utf8");

    await assert.rejects(
      () => readLaneRunState(stateRoot, "work-item-mismatch-run"),
      /Lane run state identifiers do not match the requested lane run/,
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("rejects lane run state paths outside the configured state root", () => {
  const stateRoot = path.join(os.tmpdir(), "ensen-loop-state-root");

  assert.throws(
    () => resolveLaneRunStatePath(stateRoot, "../outside"),
    /Lane run identifiers may only contain/,
  );
  assert.throws(
    () => resolveLaneRunStatePath(stateRoot, "nested/outside"),
    /Lane run identifiers may only contain/,
  );
});

test("rejects lane run state payloads that violate the published schema shape", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  const cases: readonly [string, (state: Record<string, unknown>) => void][] = [
    ["revision-zero", (state) => {
      state.revision = 0;
    }],
    ["empty-work-item", (state) => {
      state.workItemId = "";
    }],
    ["invalid-created-at", (state) => {
      state.createdAt = "2026-04-29";
    }],
    ["impossible-recorded-at", (state) => {
      const journal = state.journal as Record<string, unknown>;
      const entries = journal.entries as Record<string, unknown>[];
      entries[0].recordedAt = "2026-02-31T09:00:00.000Z";
    }],
    ["empty-journal-message", (state) => {
      const journal = state.journal as Record<string, unknown>;
      const entries = journal.entries as Record<string, unknown>[];
      entries[0].message = "";
    }],
    ["empty-audit-ref", (state) => {
      state.audit = {
        eventRefs: [""],
      };
    }],
    ["empty-evidence-ref", (state) => {
      state.evidence = {
        bundleRefs: [""],
      };
    }],
    ["extra-top-level-property", (state) => {
      state.extra = true;
    }],
    ["extra-journal-property", (state) => {
      (state.journal as Record<string, unknown>).extra = true;
    }],
    ["extra-entry-property", (state) => {
      const journal = state.journal as Record<string, unknown>;
      const entries = journal.entries as Record<string, unknown>[];
      entries[0].extra = true;
    }],
    ["extra-audit-property", (state) => {
      (state.audit as Record<string, unknown>).extra = true;
    }],
    ["extra-evidence-property", (state) => {
      (state.evidence as Record<string, unknown>).extra = true;
    }],
  ];

  try {
    for (const [laneRunId, mutate] of cases) {
      const statePath = resolveLaneRunStatePath(stateRoot, laneRunId);
      const state = JSON.parse(serializeLaneRunState(createTestLaneRunState(laneRunId))) as Record<string, unknown>;
      mutate(state);

      await mkdir(path.dirname(statePath), { recursive: true });
      await writeFile(statePath, JSON.stringify(state), "utf8");

      await assert.rejects(
        () => readLaneRunState(stateRoot, laneRunId),
        /Lane run state is malformed|Lane run state identifiers do not match/,
      );
    }
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("rejects malformed durable lane run state on read", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    const statePath = resolveLaneRunStatePath(stateRoot, "malformed-run");
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(
      statePath,
      JSON.stringify({
        id: "malformed-run",
        workItemId: "work-item-3",
        status: "queued",
        revision: 1,
        createdAt: "2026-04-29T09:00:00.000Z",
        updatedAt: "2026-04-29T09:00:00.000Z",
        startsAgentExecution: true,
        journal: {
          id: "journal-3",
          laneRunId: "malformed-run",
          workItemId: "work-item-3",
          entries: [],
        },
        audit: {
          eventRefs: [],
        },
        evidence: {
          bundleRefs: [],
        },
      }),
      "utf8",
    );

    await assert.rejects(
      () => readLaneRunState(stateRoot, "malformed-run"),
      /Lane run state must not start agent execution/,
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

function createTestLaneRunState(laneRunId: string) {
  return createLaneRunState({
    id: laneRunId,
    workItemId: `work-item-${laneRunId}`,
    status: "queued",
    revision: 1,
    createdAt: "2026-04-29T09:00:00.000Z",
    updatedAt: "2026-04-29T09:00:00.000Z",
    journal: createLaneJournal({
      id: `journal-${laneRunId}`,
      laneRunId,
      workItemId: `work-item-${laneRunId}`,
      entries: [
        {
          id: `entry-${laneRunId}`,
          recordedAt: "2026-04-29T09:00:00.000Z",
          kind: "hypothesis",
          message: "Schema validation fixture.",
        },
      ],
    }),
    audit: {
      eventRefs: ["audit-fixture"],
    },
    evidence: {
      bundleRefs: ["evidence-fixture"],
    },
  });
}
