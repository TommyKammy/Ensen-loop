import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  parseRunRequest,
  validateRunRequest,
} from "../src/protocol/run-request.js";

const execFileAsync = promisify(execFile);
const runRequestFixtureRoot = path.join(
  "protocol-snapshots",
  "ensen-protocol",
  "v0.1.0",
  "fixtures",
  "run-request",
  "v1",
);

async function listJsonFixtures(kind: "valid" | "invalid"): Promise<string[]> {
  const entries = await readdir(path.join(runRequestFixtureRoot, kind), {
    withFileTypes: true,
  });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(runRequestFixtureRoot, kind, entry.name))
    .sort();
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  assert.equal(typeof value, "object", `${label} must be an object`);
  assert.notEqual(value, null, `${label} must not be null`);
  assert.equal(Array.isArray(value), false, `${label} must not be an array`);
}

function childRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  assertRecord(value, key);
  return value;
}

test("accepts vendored RunRequest v1 valid fixtures", async () => {
  const fixturePaths = await listJsonFixtures("valid");

  for (const fixturePath of fixturePaths) {
    const request = parseRunRequest(await readJson(fixturePath));

    assert.equal(request.schemaVersion, "eip.run-request.v1");
    assert.match(request.id, /^req_/);
    assert.equal(typeof request.source.sourceType, "string");
    assert.equal(typeof request.workItem.externalId, "string");
  }
});

test("rejects vendored RunRequest v1 invalid fixtures with actionable diagnostics", async () => {
  const fixturePaths = await listJsonFixtures("invalid");

  for (const fixturePath of fixturePaths) {
    const result = validateRunRequest(await readJson(fixturePath));

    assert.equal(result.ok, false, `${fixturePath} must be rejected`);
    assert.ok(result.issues.length > 0, `${fixturePath} must include diagnostics`);
    assert.ok(
      result.issues.every((issue) => issue.path.length > 0 && issue.message.length > 0),
      `${fixturePath} diagnostics must identify paths and messages`,
    );
  }
});

test("rejects semantically wrong RunRequest id prefixes", async () => {
  const fixture = path.join(runRequestFixtureRoot, "valid", "github-issue-request.json");
  const base = await readJson(fixture);
  assertRecord(base, "fixture");

  const cases: readonly {
    readonly name: string;
    readonly mutate: (request: Record<string, unknown>) => void;
    readonly path: string;
  }[] = [
    {
      name: "request id",
      mutate: (request) => {
        request.id = "actor_01HV7Y8M8F2KQ5W3P9R6T4N2AB";
      },
      path: "id",
    },
    {
      name: "source id",
      mutate: (request) => {
        childRecord(request, "source").sourceId = "repo_01HV7Y8M8F2KQ5W3P9R6T4N2AD";
      },
      path: "source.sourceId",
    },
    {
      name: "actor id",
      mutate: (request) => {
        childRecord(request, "requestedBy").actorId = "repo_01HV7Y8M8F2KQ5W3P9R6T4N2AE";
      },
      path: "requestedBy.actorId",
    },
    {
      name: "work item id",
      mutate: (request) => {
        childRecord(request, "workItem").workItemId = "actor_01HV7Y8M8F2KQ5W3P9R6T4N2AF";
      },
      path: "workItem.workItemId",
    },
    {
      name: "target id",
      mutate: (request) => {
        childRecord(request, "target").targetId = "actor_01HV7Y8M8F2KQ5W3P9R6T4N2AG";
      },
      path: "target.targetId",
    },
    {
      name: "policy set id",
      mutate: (request) => {
        childRecord(request, "policyContext").policySetId = "repo_01HV7Y8M8F2KQ5W3P9R6T4N2AH";
      },
      path: "policyContext.policySetId",
    },
  ];

  for (const testCase of cases) {
    const request = structuredClone(base);
    assertRecord(request, testCase.name);
    testCase.mutate(request);

    const result = validateRunRequest(request);

    assert.equal(result.ok, false, `${testCase.name} must be rejected`);
    assert.ok(
      result.issues.some((issue) => issue.path === testCase.path),
      `${testCase.name} must include a ${testCase.path} diagnostic`,
    );
  }
});

test("rejects malformed and non-HTTPS RunRequest work item URLs", async () => {
  const fixture = path.join(runRequestFixtureRoot, "valid", "github-issue-request.json");
  const base = await readJson(fixture);
  assertRecord(base, "fixture");

  for (const url of ["https:///repo", "https://?q=1", "http://example.com", " https://example.com"]) {
    const request = structuredClone(base);
    assertRecord(request, "request");
    childRecord(request, "workItem").url = url;

    const result = validateRunRequest(request);

    assert.equal(result.ok, false, `${url} must be rejected`);
    assert.ok(
      result.issues.some((issue) => issue.path === "workItem.url"),
      `${url} must include a workItem.url diagnostic`,
    );
  }
});

test("CLI reports accepted or rejected RunRequest files", async () => {
  const validFixture = path.join(runRequestFixtureRoot, "valid", "manual-request.json");
  const invalidFixture = path.join(runRequestFixtureRoot, "invalid", "source-string.json");

  const accepted = await execFileAsync(process.execPath, [
    "dist/src/cli/index.js",
    "run-request",
    validFixture,
  ]);
  assert.equal(accepted.stderr, "");
  assert.deepEqual(JSON.parse(accepted.stdout) as unknown, {
    ok: true,
    request: parseRunRequest(await readJson(validFixture)),
  });

  await assert.rejects(
    execFileAsync(process.execPath, [
      "dist/src/cli/index.js",
      "run-request",
      invalidFixture,
    ]),
    (error: unknown) => {
      assert.ok(error && typeof error === "object");
      assert.ok("code" in error);
      assert.equal(error.code, 1);
      assert.ok("stdout" in error && typeof error.stdout === "string");

      const rejected = JSON.parse(error.stdout) as {
        ok: boolean;
        issues: readonly { path: string; message: string }[];
      };

      assert.equal(rejected.ok, false);
      assert.deepEqual(rejected.issues, [
        {
          path: "source",
          message: "source must be a JSON object.",
        },
      ]);

      return true;
    },
  );
});
