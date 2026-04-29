# Ensen-loop

Ensen-loop is an independent development lane engine and successor product to codex-supervisor. It provides the standalone baseline for issue-driven software delivery workflows that can evolve without depending on the Ensen-flow implementation.

## Baseline

This repository starts as a minimal TypeScript/Node project with a build, smoke test, CI workflow, and repository hygiene rules. The baseline is intentionally small so future work can add the lane engine contracts and runtime behavior behind a stable quality gate.

The Phase 1 module boundaries and vocabulary are defined in [docs/architecture/core-model.md](docs/architecture/core-model.md).

The Phase 1 local Work Item validation skeleton is documented in [docs/reference/work-item-contract.md](docs/reference/work-item-contract.md).

## Commands

```sh
npm ci
npm run build
npm test
node dist/src/cli/index.js dry-run --sample
```

`dry-run --sample` emits a deterministic local execution plan as JSON. It describes the work item, lane workspace, agent provider, SCM provider, verification, and evidence intents without creating worktrees, branches, commits, change requests, durable evidence, or invoking external providers.

## Scope

Ensen-loop must remain independently buildable and testable. EIP RunRequest and RunResult support is not implemented in this baseline and belongs to a later phase.
