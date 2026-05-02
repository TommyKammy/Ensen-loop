import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AGENT_PROVIDER_CAPABILITIES,
  SCM_PROVIDER_CAPABILITIES,
  type AgentProvider,
  type ScmProvider,
} from "../src/core/index.js";
import { createSampleDryRunExecutionPlan } from "../src/lane/index.js";
import {
  createRunRequestExecutionPlan,
  parseRunRequest,
} from "../src/protocol/index.js";

const expectedScmProviderCapabilities = [
  "work-item-pickup",
  "lane-branch-intent",
  "lane-worktree-intent",
  "change-request-intent",
  "status-reporting",
] as const;

const expectedAgentProviderCapabilities = [
  "dry-run-intent",
  "execute-intent",
] as const;

test("defines provider-neutral SCM and agent capability vocabulary", () => {
  assert.deepEqual(SCM_PROVIDER_CAPABILITIES, expectedScmProviderCapabilities);
  assert.deepEqual(AGENT_PROVIDER_CAPABILITIES, expectedAgentProviderCapabilities);

  const scmProvider: ScmProvider = {
    id: "initial-scm-adapter",
    displayName: "Initial SCM adapter",
    capabilities: SCM_PROVIDER_CAPABILITIES,
  };
  const agentProvider: AgentProvider = {
    id: "initial-agent-adapter",
    displayName: "Initial agent adapter",
    capabilities: AGENT_PROVIDER_CAPABILITIES,
  };

  assert.equal(scmProvider.capabilities.includes("status-reporting"), true);
  assert.equal(agentProvider.capabilities.includes("execute-intent"), true);
  assert.doesNotMatch(JSON.stringify({ scmProvider, agentProvider }), /\b(GitHub|Codex|gh)\b/i);
});

test("keeps lane and run-request capability output stable after attempted vocabulary mutation", async () => {
  const request = parseRunRequest(
    JSON.parse(
      await readFile(
        "protocol-snapshots/ensen-protocol/v0.2.0/fixtures/run-request/v1/valid/github-issue-request.json",
        "utf8",
      ),
    ) as unknown,
  );
  const mutableScmCapabilities = SCM_PROVIDER_CAPABILITIES as unknown as string[];
  const mutableAgentCapabilities = AGENT_PROVIDER_CAPABILITIES as unknown as string[];

  try {
    try {
      mutableScmCapabilities.push("runtime-mutated-scm-capability");
    } catch (error) {
      assert.ok(error instanceof TypeError);
    }
    try {
      mutableAgentCapabilities.push("runtime-mutated-agent-capability");
    } catch (error) {
      assert.ok(error instanceof TypeError);
    }

    const dryRunPlan = createSampleDryRunExecutionPlan();
    const runRequestPlan = createRunRequestExecutionPlan(request);

    assert.deepEqual(dryRunPlan.scmProvider.capabilities, expectedScmProviderCapabilities);
    assert.deepEqual(dryRunPlan.agentProvider.capabilities, expectedAgentProviderCapabilities);
    assert.deepEqual(runRequestPlan.scmProvider.capabilities, expectedScmProviderCapabilities);
    assert.deepEqual(runRequestPlan.agentProvider.capabilities, expectedAgentProviderCapabilities);
  } finally {
    if (mutableScmCapabilities.length > expectedScmProviderCapabilities.length) {
      mutableScmCapabilities.splice(expectedScmProviderCapabilities.length);
    }
    if (mutableAgentCapabilities.length > expectedAgentProviderCapabilities.length) {
      mutableAgentCapabilities.splice(expectedAgentProviderCapabilities.length);
    }
  }
});

test("documents Phase 4 provider boundaries without making initial adapters core concepts", async () => {
  const providerDocs = await readFile("docs/architecture/provider-capabilities.md", "utf8");

  for (const capability of SCM_PROVIDER_CAPABILITIES) {
    assert.match(providerDocs, new RegExp(`\\b${capability}\\b`));
  }
  for (const capability of AGENT_PROVIDER_CAPABILITIES) {
    assert.match(providerDocs, new RegExp(`\\b${capability}\\b`));
  }

  assert.match(providerDocs, /GitHub adapter/i);
  assert.match(providerDocs, /Codex adapter/i);
  assert.match(providerDocs, /GitLab/i);
  assert.match(providerDocs, /OpenCode/i);
  assert.match(providerDocs, /Claude Code/i);
  assert.match(
    providerDocs,
    /protocol-snapshots\/ensen-protocol\/v0\.2\.0\/fixtures\/capability-variants\/v1\/valid\//,
  );
  assert.match(providerDocs, /eip\.capability-variant\.example\.v1/);
  assert.match(providerDocs, /do not rename RunRequest, RunStatusSnapshot, RunResult, or\s+EvidenceBundleRef artifacts to `v2`/);
  assert.doesNotMatch(providerDocs, /Ensen-flow checkout|Ensen-flow service|Ensen-flow package/i);
});
