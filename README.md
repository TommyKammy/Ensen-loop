# Ensen-loop

Ensen-loop is an independent development lane engine and successor product to codex-supervisor. It provides the standalone baseline for issue-driven software delivery workflows that can evolve without depending on the Ensen-flow implementation.

## Baseline

This repository starts as a minimal TypeScript/Node project with a build, smoke test, CI workflow, and repository hygiene rules. The baseline is intentionally small so future work can add the lane engine contracts and runtime behavior behind a stable quality gate.

The Phase 1 module boundaries and vocabulary are defined in [docs/architecture/core-model.md](docs/architecture/core-model.md).

The Ensen-loop mission and development charter alignment are summarized in [docs/mission.md](docs/mission.md).

The Phase 1 local Work Item validation skeleton is documented in [docs/reference/work-item-contract.md](docs/reference/work-item-contract.md).

The copied Ensen-protocol v0.1.0 schema and conformance fixture snapshot is documented in [protocol-snapshots/ensen-protocol/v0.1.0/README.md](protocol-snapshots/ensen-protocol/v0.1.0/README.md). It is repo-owned fixture data, not a mutable shared runtime dependency.

## Commands

```sh
npm ci
npm run typecheck
npm run build
npm test
node dist/src/cli/index.js dry-run --sample
node dist/src/cli/index.js run-request <run-request-json-file>
```

`dry-run --sample` emits a deterministic local execution plan as JSON. It describes the work item, lane workspace, agent provider, SCM provider, verification, and evidence intents without creating worktrees, branches, commits, change requests, durable evidence, or invoking external providers.

`run-request <run-request-json-file>` reads an EIP RunRequest v1 JSON file, validates it at the protocol input boundary, and emits either `{ "ok": true, "request": ... }` or `{ "ok": false, "issues": [...] }`. The `source` field is protocol input data, not trusted internal authority.

## Scope

Ensen-loop must remain independently buildable and testable. EIP RunRequest input support is limited to the explicit file validation boundary. RunResult support belongs to a later phase.
