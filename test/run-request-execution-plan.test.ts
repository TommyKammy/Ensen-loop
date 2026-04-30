import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  createRunRequestExecutionPlan,
  parseRunRequest,
} from "../src/protocol/index.js";
import type { RunRequest } from "../src/protocol/index.js";

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Property in keyof T]: Mutable<T[Property]> }
    : T;

const runRequestFixtureRoot = path.join(
  "protocol-snapshots",
  "ensen-protocol",
  "v0.1.0",
  "fixtures",
  "run-request",
  "v1",
  "valid",
);

async function readRunRequestFixture(name: string) {
  return parseRunRequest(
    JSON.parse(await readFile(path.join(runRequestFixtureRoot, name), "utf8")) as unknown,
  );
}

test("maps an issue-like RunRequest into a bounded execution plan", async () => {
  const request = await readRunRequestFixture("github-issue-request.json");

  const plan = createRunRequestExecutionPlan(request);

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
        sourceId: "source_01HV7Y8M8F2KQ5W3P9R6T4N2AD",
        sourceType: "github",
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
        actorId: "actor_01HV7Y8M8F2KQ5W3P9R6T4N2AE",
        actorType: "api_client",
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
      invokesProvider: false,
    },
    scmProvider: {
      intent: "normalize repository intent without creating branches, commits, or change requests",
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
});

test("maps incomplete manual RunRequest scope into a blocked plan", async () => {
  const request = await readRunRequestFixture("manual-request.json");

  const plan = createRunRequestExecutionPlan(request);

  assert.equal(plan.status, "blocked");
  assert.deepEqual(plan.blockedReasons, [
    "target is required before execution can be planned",
    "policyContext is required before execution can be planned",
  ]);
  assert.deepEqual(plan.workItem, {
    id: "workitem_01HV7Y8M8F2KQ5W3P9R6T4N2BE",
    title: "Review protocol fixture coverage",
    source: "eip.run-request:manual",
    status: "blocked",
  });
  assert.equal(plan.laneWorkspace.mutatesFilesystem, false);
  assert.equal(plan.agentProvider.invokesProvider, false);
  assert.equal(plan.scmProvider.createsBranch, false);
  assert.equal(plan.evidence.writesDurableEvidence, false);
});

test("copies mutable request boundary fields into the execution plan", async () => {
  const request = (await readRunRequestFixture("github-issue-request.json")) as Mutable<RunRequest>;

  const plan = createRunRequestExecutionPlan(request);

  assert.ok(request.target);
  assert.ok(request.policyContext?.riskClasses);
  assert.notStrictEqual(plan.provenance.source, request.source);
  assert.notStrictEqual(plan.requestIdentity.requestedBy, request.requestedBy);
  assert.notStrictEqual(plan.laneWorkspace.target, request.target);
  assert.notStrictEqual(plan.policy.riskClasses, request.policyContext.riskClasses);

  request.source.externalRef = "mutated/source";
  request.requestedBy.displayName = "Mutated requester";
  request.target.externalRef = "mutated/target";
  request.policyContext.riskClasses.push("mutated-risk");

  assert.equal(plan.provenance.source.externalRef, "TommyKammy/Ensen-protocol");
  assert.equal(plan.requestIdentity.requestedBy.displayName, "Ensen issue dispatcher");
  assert.equal(plan.laneWorkspace.target?.externalRef, "TommyKammy/Ensen-protocol");
  assert.deepEqual(plan.policy.riskClasses, ["secrets"]);
});

test("orders extension facts with locale-independent code point comparison", async () => {
  const fixtureRequest = await readRunRequestFixture("github-issue-request.json");
  const request: RunRequest = {
    ...fixtureRequest,
    extensions: {
      "x-z": 3,
      "x-ä": 4,
      "x-a": 2,
      "x-Z": 1,
    },
  };

  const plan = createRunRequestExecutionPlan(request);

  assert.deepEqual(
    plan.boundedInputFacts
      .filter((fact) => fact.name.startsWith("extensions."))
      .map((fact) => fact.name),
    ["extensions.x-Z", "extensions.x-a", "extensions.x-z", "extensions.x-ä"],
  );
});
