import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  evaluateIssueReadiness,
  type IssueReadinessInput,
} from "../src/work-item/index.js";

const runnableInput: IssueReadinessInput = {
  workItem: {
    id: "github:TommyKammy/Ensen-loop#57",
    title: "LOOP-032: Add issue readiness evaluation",
    source: "github-issue",
    status: "ready",
  },
  scope: {
    ownerControlled: true,
  },
  issue: {
    acceptanceCriteria: [
      "Readiness evaluation returns a parseable runnable result.",
      "Readiness diagnostics remain pre-execution only.",
    ],
    behaviorDeltas: ["Add issue readiness evaluation before lane execution."],
    scopeItems: ["Evaluate mapped WorkItem facts before worktree creation."],
    requestedCapabilities: ["work-item-readiness"],
    eipMajorVersion: 2,
    terminalState: "open",
  },
};

test("returns a runnable readiness result for a bounded owner-controlled issue", () => {
  const result = evaluateIssueReadiness(runnableInput);

  assert.equal(result.status, "runnable");
  assert.equal(result.runnable, true);
  assert.equal(result.workItem.id, runnableInput.workItem.id);
  assert.equal(result.workItem.title, runnableInput.workItem.title);
  assert.deepEqual(result.diagnostics, [
    {
      category: "validation_failure",
      path: "issue.behaviorDeltas",
      message: "Issue has one observable behavior delta.",
      severity: "info",
    },
  ]);
  assert.deepEqual(result.boundary, {
    capability: "work-item-readiness",
    startsExecution: false,
    emitsProtocolTerminalArtifact: false,
    protocolRuntimeImported: false,
    providerNeutral: true,
  });
});

test("blocks multi-delta issues before lane execution", () => {
  const result = evaluateIssueReadiness({
    ...runnableInput,
    issue: {
      ...runnableInput.issue,
      behaviorDeltas: [
        "Add issue readiness evaluation.",
        "Start lane execution from readiness.",
      ],
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.runnable, false);
  assert.deepEqual(result.diagnostics, [
    {
      category: "behavior_delta_violation",
      path: "issue.behaviorDeltas",
      message: "Issue must describe exactly one observable behavior delta.",
      severity: "blocker",
    },
  ]);
});

test("blocks missing owner-controlled scope and unsafe issue inputs", () => {
  const result = evaluateIssueReadiness({
    ...runnableInput,
    scope: {
      ownerControlled: false,
    },
    issue: {
      ...runnableInput.issue,
      unsafeInputs: ["placeholder-token"],
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.runnable, false);
  assert.deepEqual(result.diagnostics, [
    {
      category: "provider_rejection_before_run_binding",
      path: "scope.ownerControlled",
      message: "Issue scope must be explicitly owner-controlled before lane execution.",
      severity: "blocker",
    },
    {
      category: "evidence_unavailable",
      path: "issue.unsafeInputs[0]",
      message: "Issue readiness input contains unsafe or secret-like evidence.",
      severity: "blocker",
    },
  ]);
});

test("blocks unsupported EIP major versions without producing terminal protocol output", () => {
  const result = evaluateIssueReadiness({
    ...runnableInput,
    issue: {
      ...runnableInput.issue,
      eipMajorVersion: 3,
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.runnable, false);
  assert.deepEqual(result.diagnostics, [
    {
      category: "unsupported_eip_major_version",
      path: "issue.eipMajorVersion",
      message: "Issue references an unsupported EIP major version.",
      severity: "blocker",
    },
  ]);
  assert.equal(result.boundary.emitsProtocolTerminalArtifact, false);
});

test("blocks oversized, unsupported-capability, and ambiguous terminal-state inputs", () => {
  const result = evaluateIssueReadiness({
    ...runnableInput,
    issue: {
      ...runnableInput.issue,
      acceptanceCriteria: Array.from(
        { length: 13 },
        (_value, index) => `Criterion ${index + 1}`,
      ),
      requestedCapabilities: ["work-item-readiness", "submit"],
      terminalState: "unknown",
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.runnable, false);
  assert.deepEqual(result.diagnostics, [
    {
      category: "validation_failure",
      path: "issue.acceptanceCriteria",
      message: "Issue acceptance criteria are too broad for one lane run.",
      severity: "blocker",
    },
    {
      category: "unsupported_capability",
      path: "issue.requestedCapabilities[1]",
      message: "Issue requests an unsupported pre-execution capability.",
      severity: "blocker",
    },
    {
      category: "unknown_failure",
      path: "issue.terminalState",
      message: "Issue terminal state is ambiguous or not open for readiness evaluation.",
      severity: "blocker",
    },
  ]);
});

test("blocks missing terminal state before readiness can become runnable", () => {
  const result = evaluateIssueReadiness({
    ...runnableInput,
    issue: {
      acceptanceCriteria: runnableInput.issue?.acceptanceCriteria,
      behaviorDeltas: runnableInput.issue?.behaviorDeltas,
      scopeItems: runnableInput.issue?.scopeItems,
      requestedCapabilities: runnableInput.issue?.requestedCapabilities,
      eipMajorVersion: runnableInput.issue?.eipMajorVersion,
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.runnable, false);
  assert.deepEqual(result.diagnostics, [
    {
      category: "unknown_failure",
      path: "issue.terminalState",
      message: "Issue terminal state is ambiguous or not open for readiness evaluation.",
      severity: "blocker",
    },
  ]);
});

test("blocks generic absolute local paths in public issue text without echoing them", () => {
  const posixPath = ["", "tmp", "build", "output.log"].join("/");
  const windowsDrivePath = ["D:", "agent", "work", "repo"].join("\\");
  const uncPath = ["", "", "agent-share", "work", "repo"].join("\\");
  const result = evaluateIssueReadiness({
    ...runnableInput,
    issue: {
      ...runnableInput.issue,
      bodyText: [
        "Collect output from",
        posixPath,
        windowsDrivePath,
        uncPath,
        "before starting the lane.",
      ].join(" "),
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.runnable, false);
  assert.deepEqual(result.diagnostics, [
    {
      category: "evidence_unavailable",
      path: "issue.bodyText",
      message: "Issue readiness input contains unsafe or secret-like evidence.",
      severity: "blocker",
    },
  ]);

  const diagnosticText = JSON.stringify(result.diagnostics);
  assert.doesNotMatch(diagnosticText, new RegExp(escapeRegExp(posixPath)));
  assert.doesNotMatch(diagnosticText, new RegExp(escapeRegExp(windowsDrivePath)));
  assert.doesNotMatch(diagnosticText, new RegExp(escapeRegExp(uncPath)));
});

test("routes ambiguous or underspecified issues to human refinement", () => {
  const result = evaluateIssueReadiness({
    ...runnableInput,
    issue: {
      ...runnableInput.issue,
      acceptanceCriteria: [],
      behaviorDeltas: [],
      scopeItems: ["Clarify what should change."],
    },
  });

  assert.equal(result.status, "needs-human-refinement");
  assert.equal(result.runnable, false);
  assert.deepEqual(result.diagnostics, [
    {
      category: "validation_failure",
      path: "issue.acceptanceCriteria",
      message: "Issue needs explicit acceptance criteria before lane execution.",
      severity: "human",
    },
    {
      category: "behavior_delta_violation",
      path: "issue.behaviorDeltas",
      message: "Issue needs exactly one observable behavior delta.",
      severity: "human",
    },
  ]);
});

test("documents readiness as provider-neutral diagnostics without terminal protocol output", async () => {
  const docs = await readFile("docs/reference/issue-readiness.md", "utf8");

  assert.match(docs, /pre-execution diagnostic boundary/);
  assert.match(docs, /provider-neutral WorkItem facts/);
  assert.match(docs, /1 issue = 1 behavior delta/);
  assert.match(docs, /does not create a worktree, start an agent/);
  assert.match(docs, /not protocol terminal artifacts/);
  assert.match(docs, /No dependency on Ensen-flow approval or workflow state/);
  assert.doesNotMatch(docs, /\/Users\/[^/\s]+/);
  assert.doesNotMatch(docs, /[A-Za-z]:\\Users\\/);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
