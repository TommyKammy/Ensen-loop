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
