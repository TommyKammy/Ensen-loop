import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function readMarkdown(relativePath: string): Promise<string> {
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

test("documents the codex-supervisor migration bridge as non-core vocabulary", async () => {
  const bridgeReadme = await readMarkdown("src/bridge/codex-supervisor/README.md");

  assert.match(bridgeReadme, /migration bridge/i);
  assert.match(bridgeReadme, /not the long-term core vocabulary/i);
});
