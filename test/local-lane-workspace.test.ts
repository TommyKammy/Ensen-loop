import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  prepareLocalLaneWorkspace,
  preparedLocalLaneMarkerFilename,
  preparedLocalLaneMarkerSchemaVersion,
  resolveLocalLaneDirectoryName,
} from "../src/lane/index.js";

test("prepares bounded local workspace and state directories for one lane run", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-workspace-"));
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    const prepared = await prepareLocalLaneWorkspace({
      workspaceRoot,
      stateRoot,
      laneRunId: "run_01HV7Y8M8F2KQ5W3P9R6T4N2AB",
      workItemId: "workitem_01HV7Y8M8F2KQ5W3P9R6T4N2AC",
    });

    assert.equal(prepared.directoryName, "run_01HV7Y8M8F2KQ5W3P9R6T4N2AB");
    assert.equal(prepared.workspacePath, path.join(workspaceRoot, "lane-runs", prepared.directoryName));
    assert.equal(prepared.statePath, path.join(stateRoot, "lane-runs", prepared.directoryName));
    assert.deepEqual(prepared.created, {
      workspace: true,
      state: true,
    });
    assert.deepEqual(
      JSON.parse(await readFile(path.join(prepared.workspacePath, preparedLocalLaneMarkerFilename), "utf8")),
      {
        schemaVersion: preparedLocalLaneMarkerSchemaVersion,
        laneRunId: prepared.directoryName,
      },
    );
    assert.deepEqual(
      JSON.parse(await readFile(path.join(prepared.statePath, preparedLocalLaneMarkerFilename), "utf8")),
      {
        schemaVersion: preparedLocalLaneMarkerSchemaVersion,
        laneRunId: prepared.directoryName,
      },
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("derives the local lane directory name from the work item when no run id is provided", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-workspace-"));
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    const prepared = await prepareLocalLaneWorkspace({
      workspaceRoot,
      stateRoot,
      workItemId: "workitem_01HV7Y8M8F2KQ5W3P9R6T4N2AC",
    });

    assert.equal(prepared.directoryName, "workitem_01HV7Y8M8F2KQ5W3P9R6T4N2AC");
    assert.equal(prepared.workspacePath, path.join(workspaceRoot, "lane-runs", prepared.directoryName));
    assert.equal(prepared.statePath, path.join(stateRoot, "lane-runs", prepared.directoryName));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("reuses an empty prepared lane directory without deleting unrelated files", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-workspace-"));
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    const first = await prepareLocalLaneWorkspace({
      workspaceRoot,
      stateRoot,
      laneRunId: "reusable-run",
    });

    const unrelatedPath = path.join(workspaceRoot, "keep.txt");
    await writeFile(unrelatedPath, "do not delete\n", "utf8");

    const second = await prepareLocalLaneWorkspace({
      workspaceRoot,
      stateRoot,
      laneRunId: "reusable-run",
    });

    assert.deepEqual(second, {
      ...first,
      created: {
        workspace: false,
        state: false,
      },
    });
    assert.equal(await readFile(unrelatedPath, "utf8"), "do not delete\n");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("rejects malformed and traversal-shaped lane directory identifiers before creating lane paths", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-workspace-"));
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));

  try {
    assert.throws(
      () => resolveLocalLaneDirectoryName({ laneRunId: "../outside" }),
      /Local lane identifiers may only contain/,
    );

    await assert.rejects(
      () => prepareLocalLaneWorkspace({ workspaceRoot, stateRoot, laneRunId: "nested/outside" }),
      /Local lane identifiers may only contain/,
    );
    await assert.rejects(
      () => prepareLocalLaneWorkspace({ workspaceRoot, stateRoot, laneRunId: "..." }),
      /Local lane identifiers must include at least one letter or number/,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("rejects missing, relative, and symlinked local lane roots before creating lane paths", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-workspace-"));
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-outside-"));
  const symlinkRoot = path.join(os.tmpdir(), `ensen-loop-root-link-${process.pid}`);

  try {
    await symlink(outsideRoot, symlinkRoot, "dir");

    await assert.rejects(
      () => prepareLocalLaneWorkspace({
        workspaceRoot: path.join(workspaceRoot, "missing"),
        stateRoot,
        laneRunId: "missing-root-run",
      }),
      /Local lane workspace root must exist before preparation/,
    );
    await assert.rejects(
      () => prepareLocalLaneWorkspace({
        workspaceRoot: "relative-workspace-root",
        stateRoot,
        laneRunId: "relative-root-run",
      }),
      /Local lane workspace root must be an absolute path/,
    );
    await assert.rejects(
      () => prepareLocalLaneWorkspace({
        workspaceRoot: symlinkRoot,
        stateRoot,
        laneRunId: "symlink-root-run",
      }),
      /Local lane workspace root must be a real directory/,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
    await rm(symlinkRoot, { force: true });
  }
});

test("rejects ambiguous shared workspace and state roots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-shared-root-"));

  try {
    await assert.rejects(
      () => prepareLocalLaneWorkspace({
        workspaceRoot: root,
        stateRoot: root,
        laneRunId: "shared-root-run",
      }),
      /workspace root and state root must be separate directories/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects symlink and outside-root lane paths without following the escape", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-workspace-"));
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-state-"));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-outside-"));

  try {
    await mkdir(path.join(workspaceRoot, "lane-runs"), { recursive: true });
    await symlink(outsideRoot, path.join(workspaceRoot, "lane-runs", "symlink-run"), "dir");

    await assert.rejects(
      () => prepareLocalLaneWorkspace({
        workspaceRoot,
        stateRoot,
        laneRunId: "symlink-run",
      }),
      /Local lane workspace path must not traverse symbolic links/,
    );
    await assert.rejects(() => readFile(path.join(outsideRoot, "state.json"), "utf8"), /ENOENT/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});
