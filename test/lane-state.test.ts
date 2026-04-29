import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
