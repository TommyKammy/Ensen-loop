import assert from "node:assert/strict";
import test from "node:test";

import {
  CODEX_AGENT_PROVIDER_CAPABILITY_EVIDENCE,
  createCodexAgentInvocationIntent,
  requireCodexProviderOperation,
} from "../src/agent/index.js";

const capabilityEvidence = CODEX_AGENT_PROVIDER_CAPABILITY_EVIDENCE;

test("represents Codex dry-run intent without starting a provider session", () => {
  const intent = createCodexAgentInvocationIntent({
    capabilityEvidence,
    workspace: {
      kind: "repo-relative",
      path: ".",
    },
  });

  assert.equal(intent.ok, true);
  assert.equal(intent.mode, "dry-run");
  assert.equal(intent.invocation.startsProviderSession, false);
  assert.equal(intent.invocation.intent, "describe-codex-invocation");
  assert.equal(intent.outcome, "planned");
  assert.deepEqual(intent.capabilityEvidence.operations, capabilityEvidence.operations);
});

test("fails closed before Codex execute intent when scope, posture, or idempotency binding is missing", () => {
  const intent = createCodexAgentInvocationIntent({
    mode: "execute",
    capabilityEvidence,
    workspace: {
      kind: "repo-relative",
      path: ".",
    },
    allowedExecutionPosture: "dry-run-only",
  });

  assert.equal(intent.ok, false);
  assert.equal(intent.mode, "execute");
  assert.equal(intent.invocation.startsProviderSession, false);
  assert.equal(intent.outcome, "blocked");
  assert.match(intent.diagnostics.join("\n"), /execute posture is not enabled/i);
  assert.match(intent.diagnostics.join("\n"), /owner-controlled scope/i);
  assert.match(intent.diagnostics.join("\n"), /idempotency binding/i);
});

test("separates guarded Codex execute intent from dry-run preview", () => {
  const intent = createCodexAgentInvocationIntent({
    mode: "execute",
    capabilityEvidence,
    workspace: {
      kind: "repo-relative",
      path: ".",
    },
    allowedExecutionPosture: "execute-enabled",
    scope: {
      owner: "TommyKammy",
      repository: "Ensen-loop",
      issueNumber: 59,
    },
    idempotencyBinding: {
      key: "issue-59-codex-submit",
      scopeFingerprint: "TommyKammy-Ensen-loop-59",
    },
  });

  assert.equal(intent.ok, true);
  assert.equal(intent.mode, "execute");
  assert.equal(intent.invocation.intent, "execute-codex-invocation");
  assert.equal(intent.invocation.startsProviderSession, false);
  assert.equal(intent.outcome, "ready-to-invoke");
  assert.deepEqual(intent.diagnostics, []);
});

test("allows repo-relative workspace names that contain literal double-dot text", () => {
  const intent = createCodexAgentInvocationIntent({
    capabilityEvidence,
    workspace: {
      kind: "repo-relative",
      path: "fixtures/v1..legacy",
    },
  });

  assert.equal(intent.ok, true);
  assert.deepEqual(intent.diagnostics, []);
});

test("requires authoritative capability support before status or cancellation operations", () => {
  assert.deepEqual(requireCodexProviderOperation(capabilityEvidence, "status"), {
    ok: false,
    diagnostic: "Codex provider operation status is partial, not supported.",
  });

  assert.deepEqual(requireCodexProviderOperation(capabilityEvidence, "cancel"), {
    ok: false,
    diagnostic: "Codex provider operation cancel is unsupported, not supported.",
  });

  assert.deepEqual(requireCodexProviderOperation(capabilityEvidence, "submit"), {
    ok: true,
  });
});

test("sanitizes Codex boundary diagnostics instead of echoing unsafe local inputs", () => {
  const intent = createCodexAgentInvocationIntent({
    mode: "execute",
    capabilityEvidence,
    workspace: {
      kind: "repo-relative",
      path: "../secret/../../etc/passwd",
    },
    allowedExecutionPosture: "execute-enabled",
    scope: {
      owner: "TommyKammy",
      repository: "Ensen-loop",
      issueNumber: 59,
    },
    idempotencyBinding: {
      key: "TODO",
      scopeFingerprint: "unsafe",
    },
  });

  const diagnostics = intent.diagnostics.join("\n");

  assert.equal(intent.ok, false);
  assert.doesNotMatch(diagnostics, /\.\.\/secret/);
  assert.doesNotMatch(diagnostics, /\bTODO\b/);
  assert.match(diagnostics, /repo-relative path without traversal/i);
  assert.match(diagnostics, /idempotency binding/i);
});

test("publishes frozen Codex provider capability evidence for protocol v0.2.0 operations", () => {
  assert.equal(Object.isFrozen(CODEX_AGENT_PROVIDER_CAPABILITY_EVIDENCE), true);
  assert.equal(Object.isFrozen(CODEX_AGENT_PROVIDER_CAPABILITY_EVIDENCE.operations), true);
  assert.deepEqual(CODEX_AGENT_PROVIDER_CAPABILITY_EVIDENCE, {
    protocolVersion: "0.2.0",
    operations: {
      submit: "supported",
      status: "partial",
      cancel: "unsupported",
      fetchEvidence: "partial",
      polling: "partial",
      evidenceReferences: "supported",
      idempotency: "supported",
    },
  });
});
