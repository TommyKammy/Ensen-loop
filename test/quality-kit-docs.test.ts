import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function readMarkdown(relativePath: string): Promise<string> {
  return readFile(path.resolve(relativePath), "utf8");
}

async function readText(relativePath: string): Promise<string> {
  return readFile(path.resolve(relativePath), "utf8");
}

test("documents the codex-supervisor handoff boundary", async () => {
  const handoff = await readMarkdown("docs/migration/codex-supervisor-handoff.md");

  for (const heading of ["Copied", "Referenced", "Rewritten", "Deferred"]) {
    assert.match(handoff, new RegExp(`\\b${heading}\\b`));
  }

  for (const term of [
    "issue pickup",
    "codex exec",
    "per-issue worktree",
    "issue journal",
    "PR creation",
    "CI polling",
    "review handling",
    "status/explain",
    "issue-lint",
    "evidence/quality kit",
  ]) {
    assert.match(handoff, new RegExp(term, "i"));
  }

  assert.doesNotMatch(handoff, /Ensen-flow checkout|Ensen-flow service|Ensen-flow package/i);
});

test("documents the quality kit verification and evidence vocabulary", async () => {
  const qualityKit = await readMarkdown("docs/reference/quality-kit.md");

  for (const term of ["verification", "evidence", "reviewability"]) {
    assert.match(qualityKit, new RegExp(term, "i"));
  }
});

test("wires the Phase 1 typecheck quality gate through package, CI, and docs", async () => {
  const packageJson = JSON.parse(await readText("package.json")) as {
    scripts?: Record<string, string>;
  };
  const ciWorkflow = await readText(".github/workflows/ci.yml");
  const qualityKit = await readMarkdown("docs/reference/quality-kit.md");
  const readme = await readMarkdown("README.md");
  const agents = await readMarkdown("AGENTS.md");

  assert.equal(packageJson.scripts?.typecheck, "tsc -p tsconfig.json --noEmit");

  const typecheckRun = ciWorkflow.search(/run:\s*npm run typecheck\b/);
  const buildRun = ciWorkflow.search(/run:\s*npm run build\b/);
  const testRun = ciWorkflow.search(/run:\s*npm (?:run test|test)\b/);

  assert.notEqual(typecheckRun, -1, "CI workflow must run npm run typecheck");
  assert.notEqual(buildRun, -1, "CI workflow must run npm run build");
  assert.notEqual(testRun, -1, "CI workflow must run npm test or npm run test");
  assert.ok(typecheckRun < buildRun, "CI workflow must typecheck before build");
  assert.ok(typecheckRun < testRun, "CI workflow must typecheck before test");

  for (const document of [qualityKit, readme, agents]) {
    assert.match(document, /\bnpm run typecheck\b/);
  }
});

test("documents the codex-supervisor migration bridge as non-core vocabulary", async () => {
  const bridgeReadme = await readMarkdown("src/bridge/codex-supervisor/README.md");

  assert.match(bridgeReadme, /migration bridge/i);
  assert.match(bridgeReadme, /not the long-term core vocabulary/i);
});

test("documents the Phase 3 local lane execution contract", async () => {
  const contract = await readMarkdown("docs/architecture/local-lane-execution.md");
  const readme = await readMarkdown("README.md");

  for (const term of [
    "RunRequest v1",
    "LaneRunState",
    "RunStatusSnapshot",
    "RunResult",
    "EvidenceBundleRef",
    "unsupported EIP major versions",
    "TommyKammy/Ensen-protocol#28",
    "X-Gate 2",
    "production automation",
  ]) {
    assert.match(contract, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }

  for (const phrase of [
    "does not invoke an Agent Provider",
    "does not require Ensen-flow",
    "fail closed",
    "stable identifiers",
    "workspace root",
    "state root",
    "ambiguous executor outcome",
    "dogfood repository allowlist",
    "GitHub WorkItem pickup",
    "not execution authority by itself",
  ]) {
    assert.match(contract, new RegExp(phrase, "i"));
  }

  assert.match(readme, /docs\/architecture\/local-lane-execution\.md/);
  assert.doesNotMatch(
    contract,
    /\/Users\/[^/\s]+|\/home\/[^/\s]+|\/root(?:\/|\b)|[A-Z]:[\\/]+Users[\\/]|~[\\/]/i,
  );
});

test("documents the Track B customer repository allowlist boundary", async () => {
  const contract = await readMarkdown("docs/architecture/local-lane-execution.md");
  const providerCapabilities = await readMarkdown("docs/architecture/provider-capabilities.md");
  const readme = await readMarkdown("README.md");
  const combined = `${contract}\n${providerCapabilities}\n${readme}`;

  for (const phrase of [
    "customer repository allowlist",
    "Track B",
    "owner",
    "repository name",
    "<repository-root>",
    "purpose",
    "approval note",
    "not owner-controlled dogfood",
    "sanitized",
    "not production-ready customer execution",
    "compliance guarantee",
  ]) {
    assert.match(combined, new RegExp(phrase, "i"));
  }

  assert.doesNotMatch(
    combined,
    /\/Users\/[^/\s]+|\/home\/[^/\s]+|\/root(?:\/|\b)|[A-Z]:[\\/]+Users[\\/]|~[\\/]/i,
  );
});

test("documents dogfood rollback and cleanup boundaries", async () => {
  const runbook = await readMarkdown("docs/runbooks/dogfood-rollback-cleanup.md");

  for (const term of [
    "failed",
    "blocked",
    "no-op",
    "retryable",
    "discard",
    "manual repair",
    "abandon",
    "worktree",
    "branch",
    "patch artifact",
    "lane state",
    "journal",
    "evidence",
    "operator confirmation",
  ]) {
    assert.match(runbook, new RegExp(term, "i"));
  }

  assert.match(runbook, /CODEX_SUPERVISOR_CONFIG/);
  assert.match(runbook, /<supervisor-config-path>/);
  assert.doesNotMatch(
    runbook,
    /\/Users\/[^/\s]+|\/home\/[^/\s]+|\/root(?:\/|\b)|[A-Z]:[\\/]+Users[\\/]|~[\\/]/i,
  );
  assert.doesNotMatch(
    runbook,
    /customer|regulated|ERPNext|electronic signature|batch release|final disposition/i,
  );
});

test("documents Loop X-Gate 3 Track A closure evidence", async () => {
  const readme = await readMarkdown("README.md");

  for (const phrase of [
    "X-Gate 3 Track A Closure Evidence",
    "owner-controlled repo / solo dogfood",
    "LOOP-X3A-001",
    "LOOP-X3A-002",
    "LOOP-X3A-003",
    "LOOP-X3A-004",
    "FOLLOW-UP: Bind dry-run proof to dogfood execute scope",
    "LOOP-X3A-005",
    "LOOP-X3A-006",
    "Ensen-protocol v0.3.0",
    "TommyKammy/Ensen-protocol#50",
    "TommyKammy/Ensen-protocol#51",
    "c33277e5a470883493f10f2c6951a0ca0d5818b0",
    "protocol-snapshots/ensen-protocol/v0.3.0",
    "local conformance evidence",
    "no Ensen-flow runtime behavior",
    "no Ensen-protocol runtime dependency",
    "X-Gate 4 dogfood readiness",
    "Flow Track A closure",
  ]) {
    assert.match(readme, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }

  for (const trackBNonGoal of [
    "customer repos",
    "ERPNext live connector",
    "regulated data",
    "electronic signatures",
    "batch release",
    "final disposition",
    "compliance guarantees",
  ]) {
    assert.match(readme, new RegExp(trackBNonGoal, "i"));
  }

  assert.doesNotMatch(
    readme,
    /\/Users\/[^/\s]+|\/home\/[^/\s]+|\/root(?:\/|\b)|[A-Z]:[\\/]+Users[\\/]|~[\\/]/i,
  );
});
