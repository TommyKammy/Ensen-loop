import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AGENT_PROVIDER_CAPABILITIES,
  SCM_PROVIDER_CAPABILITIES,
  type AgentProvider,
  type ScmProvider,
} from "../src/core/index.js";

test("defines provider-neutral SCM and agent capability vocabulary", () => {
  assert.deepEqual(SCM_PROVIDER_CAPABILITIES, [
    "work-item-pickup",
    "lane-branch-intent",
    "lane-worktree-intent",
    "change-request-intent",
    "status-reporting",
  ]);
  assert.deepEqual(AGENT_PROVIDER_CAPABILITIES, [
    "dry-run-intent",
    "execute-intent",
  ]);

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
  assert.doesNotMatch(providerDocs, /Ensen-flow checkout|Ensen-flow service|Ensen-flow package/i);
});
