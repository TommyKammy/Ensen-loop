import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  AGENT_PROVIDER_CAPABILITIES,
  SCM_PROVIDER_CAPABILITIES,
  createRunRequestExecutionPlan,
  createRunResult,
  createRunStatusSnapshot,
  createSampleDryRunExecutionPlan,
  validateEvidenceBundleRef,
  validateRunRequest,
  validateRunResult,
  validateRunStatusSnapshot,
} from "../src/index.js";

const snapshotRoot = path.join(
  "protocol-snapshots",
  "ensen-protocol",
  "v0.1.0",
);
const fixtureRoot = path.join(snapshotRoot, "fixtures");
const protocolLabel = "Ensen-protocol v0.1.0 / EIP 0.1.0";

const fixtureSurfaces = [
  {
    name: "RunRequest",
    path: "run-request/v1",
    validate: validateRunRequest,
  },
  {
    name: "RunStatusSnapshot",
    path: "run-status/v1",
    validate: validateRunStatusSnapshot,
  },
  {
    name: "RunResult",
    path: "run-result/v1",
    validate: validateRunResult,
  },
  {
    name: "EvidenceBundleRef",
    path: "evidence-bundle-ref/v1",
    validate: validateEvidenceBundleRef,
  },
] as const;

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function listJsonFixtures(relativePath: string): Promise<string[]> {
  const entries = await readdir(path.join(fixtureRoot, relativePath), {
    withFileTypes: true,
  });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(fixtureRoot, relativePath, entry.name))
    .sort();
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  assert.equal(typeof value, "object", `${label} must be an object`);
  assert.notEqual(value, null, `${label} must not be null`);
  assert.equal(Array.isArray(value), false, `${label} must not be an array`);
}

test(`${protocolLabel} valid fixtures are consumed at every supported boundary`, async () => {
  for (const surface of fixtureSurfaces) {
    const fixturePaths = await listJsonFixtures(path.join(surface.path, "valid"));

    assert.ok(fixturePaths.length > 0, `${surface.name} must include valid fixtures`);

    for (const fixturePath of fixturePaths) {
      const result = surface.validate(await readJson(fixturePath));

      assert.equal(result.ok, true, `${surface.name} fixture ${fixturePath} must pass`);
    }
  }
});

test(`${protocolLabel} invalid fixtures fail closed at every supported boundary`, async () => {
  for (const surface of fixtureSurfaces) {
    const fixturePaths = await listJsonFixtures(path.join(surface.path, "invalid"));

    assert.ok(fixturePaths.length > 0, `${surface.name} must include invalid fixtures`);

    for (const fixturePath of fixturePaths) {
      const result = surface.validate(await readJson(fixturePath));

      assert.equal(result.ok, false, `${surface.name} fixture ${fixturePath} must be rejected`);
      assert.ok(result.issues.length > 0, `${surface.name} rejection must include diagnostics`);
    }
  }
});

test(`${protocolLabel} dry-run consumer and producer outputs stay fixture-compatible`, async () => {
  const requestResult = validateRunRequest(
    await readJson(path.join(fixtureRoot, "run-request/v1/valid/github-issue-request.json")),
  );

  assert.equal(requestResult.ok, true, "valid RunRequest fixture must pass input validation");

  const plan = createRunRequestExecutionPlan(requestResult.request);

  assert.deepEqual(plan, {
    command: "run-request",
    mode: "plan",
    source: "eip.run-request",
    status: "ready",
    blockedReasons: [],
    provenance: {
      requestId: "req_01HV7Y8M8F2KQ5W3P9R6T4N2AB",
      correlationId: "corr_01HV7Y8M8F2KQ5W3P9R6T4N2AC",
      idempotencyKey: "github-issue-4",
      schemaVersion: "eip.run-request.v1",
      createdAt: "2026-04-29T01:45:45Z",
      source: {
        sourceType: "github",
        sourceId: "source_01HV7Y8M8F2KQ5W3P9R6T4N2AD",
        externalRef: "TommyKammy/Ensen-protocol",
      },
    },
    workItem: {
      id: "workitem_01HV7Y8M8F2KQ5W3P9R6T4N2AF",
      title: "EIP-0001: Define RunRequest v1 schema",
      source: "eip.run-request:github",
      status: "ready",
    },
    requestIdentity: {
      requestedBy: {
        actorType: "api_client",
        actorId: "actor_01HV7Y8M8F2KQ5W3P9R6T4N2AE",
        displayName: "Ensen issue dispatcher",
      },
      workItemExternalId: "4",
      workItemUrl: "https://github.com/TommyKammy/Ensen-protocol/issues/4",
    },
    boundedInputFacts: [
      {
        name: "source.externalRef",
        value: "TommyKammy/Ensen-protocol",
        trustedAuthority: false,
      },
      {
        name: "workItem.externalId",
        value: "4",
        trustedAuthority: false,
      },
      {
        name: "workItem.url",
        value: "https://github.com/TommyKammy/Ensen-protocol/issues/4",
        trustedAuthority: false,
      },
      {
        name: "target.externalRef",
        value: "TommyKammy/Ensen-protocol",
        trustedAuthority: false,
      },
      {
        name: "extensions.x-fixture-note",
        value: "synthetic GitHub issue request",
        trustedAuthority: false,
      },
    ],
    laneWorkspace: {
      intent: "normalize request scope without preparing a workspace",
      mutatesFilesystem: false,
      target: {
        targetType: "repository",
        targetId: "repo_01HV7Y8M8F2KQ5W3P9R6T4N2AG",
        externalRef: "TommyKammy/Ensen-protocol",
      },
    },
    agentProvider: {
      intent: "normalize agent intent without invoking a provider",
      capabilities: AGENT_PROVIDER_CAPABILITIES,
      invokesProvider: false,
    },
    scmProvider: {
      intent: "normalize repository intent without creating branches, commits, or change requests",
      capabilities: SCM_PROVIDER_CAPABILITIES,
      createsBranch: false,
      opensChangeRequest: false,
    },
    policy: {
      intent: "record policy hints without granting execution authority",
      trustedAuthority: false,
      policySetId: "policy_01HV7Y8M8F2KQ5W3P9R6T4N2AH",
      riskClasses: ["secrets"],
      requiresApproval: true,
    },
    verification: {
      intent: "normalize verification intent without running checks",
      commands: [],
    },
    evidence: {
      intent: "normalize evidence intent without writing durable evidence",
      writesDurableEvidence: false,
      bundleRefs: [],
    },
  });

  const status = createRunStatusSnapshot(plan, {
    status: "running",
    observedAt: "2026-04-30T00:00:02Z",
  });
  const result = createRunResult(plan, {
    status: "succeeded",
    completedAt: "2026-04-30T00:00:04Z",
    evidenceBundles: [
      {
        evidenceBundleId: "evb_01HV9ZX8J2K6T3QW4R5Y7M8N9U",
        digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    ],
  });
  const dryRun = createSampleDryRunExecutionPlan();

  assert.equal(validateRunStatusSnapshot(status).ok, true);
  assert.equal(validateRunResult(result).ok, true);
  assert.equal(dryRun.evidence.writesDurableEvidence, false);
  assert.ok(dryRun.evidence.bundleRefs.length > 0);

  for (const bundleRef of dryRun.evidence.bundleRefs) {
    const refResult = validateEvidenceBundleRef(bundleRef);

    assert.equal(refResult.ok, true, `${bundleRef.uri} must be EvidenceBundleRef-compatible`);
  }

  assertRecord(result.evidenceBundles?.[0], "RunResult evidence bundle reference");
  assert.equal(result.evidenceBundles[0].evidenceBundleId, "evb_01HV9ZX8J2K6T3QW4R5Y7M8N9U");
});
