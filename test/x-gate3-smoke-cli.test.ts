import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

import {
  validateRunResult,
  validateRunStatusSnapshot,
} from "../src/protocol/index.js";

const execFileAsync = promisify(execFile);
const fixtureRoot = path.join(
  "protocol-snapshots",
  "ensen-protocol",
  "v0.1.0",
  "fixtures",
);

async function withRoots(
  callback: (roots: { readonly workspaceRoot: string; readonly stateRoot: string }) => Promise<void>,
): Promise<void> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-xgate3-workspace-"));
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-xgate3-state-"));

  try {
    await callback({ workspaceRoot, stateRoot });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
}

function smokeArgs(
  fixturePath: string,
  roots: { readonly workspaceRoot: string; readonly stateRoot: string },
  extraArgs: readonly string[] = [],
): readonly string[] {
  return [
    "dist/src/cli/index.js",
    "x-gate3-smoke",
    fixturePath,
    "--workspace-root",
    roots.workspaceRoot,
    "--state-root",
    roots.stateRoot,
    ...extraArgs,
  ];
}

test("X-Gate 3 smoke CLI persists a succeeded local fake lane and emits protocol aggregate JSON", async () => {
  await withRoots(async (roots) => {
    const fixturePath = path.join(fixtureRoot, "run-request/v1/valid/github-issue-request.json");

    const { stdout, stderr } = await execFileAsync(process.execPath, smokeArgs(fixturePath, roots));

    assert.equal(stderr, "");

    const output = JSON.parse(stdout) as {
      schemaVersion: string;
      boundary: string;
      mutatesRepository: boolean;
      invokesProvider: boolean;
      startsAgentProviderSession: boolean;
      statusSnapshot: unknown;
      runResult: unknown;
      localArtifacts: {
        laneRunId: string;
        stateFile: string;
        evidenceMetadata: readonly string[];
      };
    };

    assert.equal(output.schemaVersion, "ensen-loop.x-gate3-local-lane-smoke.v1");
    assert.equal(output.boundary, "local-cli-bounded-fake-lane");
    assert.equal(output.mutatesRepository, false);
    assert.equal(output.invokesProvider, false);
    assert.equal(output.startsAgentProviderSession, false);

    const snapshot = validateRunStatusSnapshot(output.statusSnapshot);
    const result = validateRunResult(output.runResult);

    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.ok && snapshot.snapshot.status, "completed");
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.result.status, "succeeded");

    assert.equal(output.localArtifacts.laneRunId, "run_01HV7Y8M8F2KQ5W3P9R6T4N2AB");
    assert.equal(output.localArtifacts.stateFile, "lane-runs/run_01HV7Y8M8F2KQ5W3P9R6T4N2AB.json");
    assert.deepEqual(output.localArtifacts.evidenceMetadata, [
      "lane-runs/run_01HV7Y8M8F2KQ5W3P9R6T4N2AB/artifacts/evidence/local-lane/run_01HV7Y8M8F2KQ5W3P9R6T4N2AB.json",
    ]);

    const persistedState = JSON.parse(
      await readFile(path.join(roots.stateRoot, output.localArtifacts.stateFile), "utf8"),
    ) as { status: string; startsAgentExecution: boolean };
    assert.equal(persistedState.status, "completed");
    assert.equal(persistedState.startsAgentExecution, false);
    await access(path.join(roots.stateRoot, output.localArtifacts.evidenceMetadata[0]));
  });
});

test("X-Gate 3 smoke CLI routes failed and blocked fake outcomes through terminal projections", async () => {
  const fixturePath = path.join(fixtureRoot, "run-request/v1/valid/github-issue-request.json");

  await withRoots(async (roots) => {
    await assert.rejects(
      execFileAsync(process.execPath, smokeArgs(fixturePath, roots, ["--fixture", "failed"])),
      (error: unknown) => {
        assert.ok(error && typeof error === "object" && "stdout" in error);
        const output = JSON.parse(String(error.stdout)) as { runResult: unknown };
        const result = validateRunResult(output.runResult);
        assert.equal(result.ok, true);
        assert.equal(result.ok && result.result.status, "failed");
        return true;
      },
    );
  });

  await withRoots(async (roots) => {
    await assert.rejects(
      execFileAsync(process.execPath, smokeArgs(fixturePath, roots, ["--fixture", "blocked"])),
      (error: unknown) => {
        assert.ok(error && typeof error === "object" && "stdout" in error);
        const output = JSON.parse(String(error.stdout)) as { statusSnapshot: unknown; runResult: unknown };
        const snapshot = validateRunStatusSnapshot(output.statusSnapshot);
        const result = validateRunResult(output.runResult);
        assert.equal(snapshot.ok, true);
        assert.equal(snapshot.ok && snapshot.snapshot.status, "blocked");
        assert.equal(result.ok, true);
        assert.equal(result.ok && result.result.status, "blocked");
        return true;
      },
    );
  });
});

test("X-Gate 3 smoke CLI fails closed for invalid input and unsupported EIP major versions", async () => {
  await withRoots(async (roots) => {
    const invalidFixturePath = path.join(fixtureRoot, "run-request/v1/invalid/source-string.json");

    await assert.rejects(
      execFileAsync(process.execPath, smokeArgs(invalidFixturePath, roots)),
      (error: unknown) => {
        assert.ok(error && typeof error === "object" && "stdout" in error);
        const output = JSON.parse(String(error.stdout)) as { statusSnapshot: unknown; runResult: unknown };
        const snapshot = validateRunStatusSnapshot(output.statusSnapshot);
        const result = validateRunResult(output.runResult);
        assert.equal(snapshot.ok, true);
        assert.equal(snapshot.ok && snapshot.snapshot.status, "blocked");
        assert.match(snapshot.ok ? (snapshot.snapshot.message ?? "") : "", /source/);
        assert.equal(result.ok, true);
        assert.equal(result.ok && result.result.status, "blocked");
        return true;
      },
    );
  });

  await withRoots(async (roots) => {
    const unsupportedFixturePath = path.join(
      fixtureRoot,
      "run-request/v1/invalid/bad-schema-version.json",
    );

    await assert.rejects(
      execFileAsync(process.execPath, smokeArgs(unsupportedFixturePath, roots)),
      (error: unknown) => {
        assert.ok(error && typeof error === "object" && "stdout" in error);
        const output = JSON.parse(String(error.stdout)) as { statusSnapshot: unknown; runResult: unknown };
        const snapshot = validateRunStatusSnapshot(output.statusSnapshot);
        const result = validateRunResult(output.runResult);
        assert.equal(snapshot.ok, true);
        assert.equal(snapshot.ok && snapshot.snapshot.status, "blocked");
        assert.match(snapshot.ok ? (snapshot.snapshot.message ?? "") : "", /schemaVersion/);
        assert.equal(result.ok, true);
        assert.equal(result.ok && result.result.status, "blocked");
        return true;
      },
    );
  });
});

test("X-Gate 3 smoke CLI rejects unsafe local roots before durable lane state writes", async () => {
  await withRoots(async (roots) => {
    const fixturePath = path.join(fixtureRoot, "run-request/v1/valid/github-issue-request.json");

    await assert.rejects(
      execFileAsync(process.execPath, [
        "dist/src/cli/index.js",
        "x-gate3-smoke",
        fixturePath,
        "--workspace-root",
        "relative-workspace-root",
        "--state-root",
        roots.stateRoot,
      ]),
      (error: unknown) => {
        assert.ok(error && typeof error === "object" && "stdout" in error);
        const output = JSON.parse(String(error.stdout)) as { ok: boolean; issues: readonly { message: string }[] };
        assert.equal(output.ok, false);
        assert.match(output.issues.map((issue) => issue.message).join("\n"), /absolute path/);
        return true;
      },
    );

    await assert.rejects(
      () => access(path.join(roots.stateRoot, "lane-runs")),
      /ENOENT/,
    );
  });
});

test("X-Gate 3 smoke CLI redacts filesystem paths from preparation failures", async () => {
  await withRoots(async (roots) => {
    const fixturePath = path.join(fixtureRoot, "run-request/v1/valid/github-issue-request.json");
    const laneRunId = "run_01HV7Y8M8F2KQ5W3P9R6T4N2AB";
    const markerPath = path.join(
      roots.workspaceRoot,
      "lane-runs",
      laneRunId,
      ".ensen-loop-prepared.json",
    );

    await mkdir(markerPath, { recursive: true });
    await mkdir(path.join(roots.stateRoot, "lane-runs", laneRunId), { recursive: true });

    await assert.rejects(
      execFileAsync(process.execPath, smokeArgs(fixturePath, roots)),
      (error: unknown) => {
        assert.ok(error && typeof error === "object" && "stdout" in error);
        const output = JSON.parse(String(error.stdout)) as {
          ok: boolean;
          issues: readonly { message: string }[];
        };
        const messages = output.issues.map((issue) => issue.message).join("\n");

        assert.equal(output.ok, false);
        assert.match(messages, /EISDIR|illegal operation|directory/);
        assert.match(messages, /<local-path>/);
        assert.doesNotMatch(messages, new RegExp(escapeRegExp(roots.workspaceRoot)));
        assert.doesNotMatch(messages, new RegExp(escapeRegExp(roots.stateRoot)));
        assert.doesNotMatch(messages, new RegExp(escapeRegExp(markerPath)));
        return true;
      },
    );
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
