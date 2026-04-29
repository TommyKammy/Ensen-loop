import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { CORE_MODEL_TERMS, MODULE_BOUNDARIES } from "../src/core/index.js";

const requiredTerms = [
  "Work Item",
  "Change Request",
  "Agent Provider",
  "SCM Provider",
  "Verification Result",
  "Review Event",
  "Lane Journal",
  "Durable State",
  "Evidence Bundle",
  "Lane Run",
] as const;

const requiredModuleDirectories = [
  "src/core",
  "src/lane",
  "src/work-item",
  "src/scm",
  "src/agent",
  "src/verification",
  "src/review",
  "src/audit",
  "src/evidence",
] as const;

async function readMarkdown(relativePath: string): Promise<string> {
  return readFile(path.resolve(relativePath), "utf8");
}

test("documents the Ensen-loop core model vocabulary", async () => {
  const coreModel = await readMarkdown("docs/architecture/core-model.md");

  for (const term of requiredTerms) {
    assert.match(coreModel, new RegExp(`\\b${term}\\b`, "i"));
    assert.ok(CORE_MODEL_TERMS.includes(term));
  }

  assert.doesNotMatch(coreModel, /Ensen-flow checkout|Ensen-flow service|Ensen-flow package/i);
  assert.doesNotMatch(coreModel, /\bRunRequest\b|\bRunResult\b/);
  assert.match(coreModel, /GitHub and Codex are future adapter examples/i);
});

test("establishes Phase 1 source module boundaries", async () => {
  for (const directory of requiredModuleDirectories) {
    await access(path.resolve(directory));
    assert.ok(MODULE_BOUNDARIES.includes(directory));
  }
});
