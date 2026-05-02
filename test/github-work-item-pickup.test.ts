import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  pickupGithubIssueWorkItem,
} from "../src/scm/index.js";

const allowedIssue = {
  repository: {
    owner: "TommyKammy",
    name: "Ensen-loop",
    htmlUrl: "https://github.com/TommyKammy/Ensen-loop",
  },
  issue: {
    number: 56,
    title: "LOOP-031: Add GitHub WorkItem pickup for owner-controlled repos",
    state: "open",
    htmlUrl: "https://github.com/TommyKammy/Ensen-loop/issues/56",
  },
  requester: {
    login: "owner-maintainer",
  },
};

const allowlist = [
  {
    owner: "TommyKammy",
    name: "Ensen-loop",
    ownerControlled: true,
  },
] as const;

test("maps an allowed GitHub issue into provider-neutral WorkItem pickup facts", () => {
  const result = pickupGithubIssueWorkItem({
    allowlist,
    issue: allowedIssue,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.workItem, {
    id: "github:TommyKammy/Ensen-loop#56",
    title: "LOOP-031: Add GitHub WorkItem pickup for owner-controlled repos",
    source: "github-issue",
    status: "ready",
  });
  assert.deepEqual(result.scope, {
    provider: "github",
    repository: "TommyKammy/Ensen-loop",
    issueNumber: 56,
    issueUrl: "https://github.com/TommyKammy/Ensen-loop/issues/56",
    repositoryUrl: "https://github.com/TommyKammy/Ensen-loop",
    requester: "owner-maintainer",
    ownerControlled: true,
  });
  assert.deepEqual(result.boundary, {
    capability: "work-item-pickup",
    readOnly: true,
    mutatesProvider: false,
    startsExecution: false,
    executorCapabilitiesAdvertised: [],
    protocolRuntimeImported: false,
  });
});

test("keeps advertised executor capabilities immutable at runtime", () => {
  const result = pickupGithubIssueWorkItem({
    allowlist,
    issue: allowedIssue,
  });

  assert.equal(result.ok, true);
  assert.equal(Object.isFrozen(result.boundary.executorCapabilitiesAdvertised), true);
  assert.throws(() => {
    (result.boundary.executorCapabilitiesAdvertised as unknown as string[]).push("submit");
  }, TypeError);
  assert.deepEqual(result.boundary.executorCapabilitiesAdvertised, []);
});

test("fails closed when the GitHub repository is not owner-controlled allowed scope", () => {
  const result = pickupGithubIssueWorkItem({
    allowlist,
    issue: {
      ...allowedIssue,
      repository: {
        ...allowedIssue.repository,
        name: "other-repo",
        htmlUrl: "https://github.com/TommyKammy/other-repo",
      },
      issue: {
        ...allowedIssue.issue,
        htmlUrl: "https://github.com/TommyKammy/other-repo/issues/56",
      },
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, [
    {
      path: "repository",
      message: "GitHub repository must be explicitly allowlisted as owner-controlled.",
    },
  ]);
});

test("fails closed for malformed issue references and missing GitHub facts", () => {
  const result = pickupGithubIssueWorkItem({
    allowlist,
    issue: {
      repository: {
        owner: "TommyKammy",
        name: "Ensen-loop",
      },
      issue: {
        number: 0,
        title: " ",
        state: "triaged",
      },
      requester: {},
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, [
    {
      path: "issue.number",
      message: "GitHub issue number must be a positive safe integer.",
    },
    {
      path: "issue.title",
      message: "GitHub issue title is required and must contain non-whitespace text.",
    },
    {
      path: "issue.state",
      message: "GitHub issue state must be open or closed.",
    },
    {
      path: "issue.htmlUrl",
      message: "GitHub issue URL is required and must match the repository and issue number.",
    },
    {
      path: "repository.htmlUrl",
      message: "GitHub repository URL is required and must match the repository owner/name.",
    },
    {
      path: "requester.login",
      message: "GitHub requester login is required as provenance for later lane submission.",
    },
  ]);
});

test("fails closed when owner-controlled scope is missing from the allowlist entry", () => {
  const result = pickupGithubIssueWorkItem({
    allowlist: [
      {
        owner: "TommyKammy",
        name: "Ensen-loop",
      },
    ],
    issue: allowedIssue,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, [
    {
      path: "allowlist[0].ownerControlled",
      message: "Owner-controlled repository allowlist entries must explicitly set ownerControlled: true.",
    },
    {
      path: "repository",
      message: "GitHub repository must be explicitly allowlisted as owner-controlled.",
    },
  ]);
});

test("fails closed when top-level pickup input is missing", () => {
  const result = pickupGithubIssueWorkItem(undefined);

  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, [
    {
      path: "input",
      message: "GitHub pickup input is required.",
    },
  ]);
});

test("fails closed when allowlist scope is missing or malformed", () => {
  const missingResult = pickupGithubIssueWorkItem({
    allowlist: undefined,
    issue: allowedIssue,
  } as unknown as Parameters<typeof pickupGithubIssueWorkItem>[0]);
  const malformedResult = pickupGithubIssueWorkItem({
    allowlist: {},
    issue: allowedIssue,
  } as unknown as Parameters<typeof pickupGithubIssueWorkItem>[0]);
  const malformedEntryResult = pickupGithubIssueWorkItem({
    allowlist: [null],
    issue: allowedIssue,
  } as unknown as Parameters<typeof pickupGithubIssueWorkItem>[0]);

  assert.equal(missingResult.ok, false);
  assert.deepEqual(missingResult.issues, [
    {
      path: "allowlist",
      message: "Owner-controlled repository allowlist is required and must be an array.",
    },
  ]);
  assert.equal(malformedResult.ok, false);
  assert.deepEqual(malformedResult.issues, missingResult.issues);
  assert.equal(malformedEntryResult.ok, false);
  assert.deepEqual(malformedEntryResult.issues, [
    {
      path: "allowlist[0]",
      message: "Owner-controlled repository allowlist entries must be objects.",
    },
    {
      path: "repository",
      message: "GitHub repository must be explicitly allowlisted as owner-controlled.",
    },
  ]);
});

test("documents GitHub pickup as read-only input collection without executor protocol claims", async () => {
  const docs = await readFile("docs/reference/github-work-item-pickup.md", "utf8");

  assert.match(docs, /ownerControlled: true/);
  assert.match(docs, /read-only/i);
  assert.match(docs, /must not edit issues, labels, branches,\s+comments, pull requests, commits/i);
  assert.match(docs, /must not start a Codex session/i);
  assert.match(docs, /does not implement protocol\s+`submit`, `status`, `cancel`, or `fetchEvidence`/i);
  assert.match(docs, /Protocol `v0\.2\.0` remains copied\/vendored contract evidence only/);
  assert.doesNotMatch(docs, /Ensen-protocol runtime code is required/i);
});
