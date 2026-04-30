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
node --test dist/test/eip-conformance-fixtures.test.js
node dist/src/cli/index.js dry-run --sample
node dist/src/cli/index.js run-request <run-request-json-file>
node dist/src/cli/index.js run-request <run-request-json-file> --status-snapshot queued
node dist/src/cli/index.js x-gate2-smoke <run-request-json-file>
```

`npm test` includes the EIP conformance fixture suite. After `npm run build`, `node --test dist/test/eip-conformance-fixtures.test.js` runs only the focused suite for the vendored Ensen-protocol v0.1.0 RunRequest, RunStatusSnapshot, RunResult, and EvidenceBundleRef fixtures.

`dry-run --sample` emits a deterministic local execution plan as JSON. It describes the work item, lane workspace, agent provider, SCM provider, verification, and evidence intents without creating worktrees, branches, commits, change requests, durable evidence, or invoking external providers. Its evidence section may include EvidenceBundleRef v1-compatible references as validation-ready metadata. These references identify where evidence could be found; they are not full evidence bundle artifacts and do not claim durable compliance packaging.

`run-request <run-request-json-file>` reads an EIP RunRequest v1 JSON file, validates it at the protocol input boundary, and emits either `{ "ok": true, "request": ... }` or `{ "ok": false, "issues": [...] }`. The `source` field is protocol input data, not trusted internal authority.

`run-request <run-request-json-file> --status-snapshot accepted|queued|running|blocked` emits a RunStatusSnapshot-compatible dry-run polling snapshot for the request. The mode maps only Ensen-loop dry-run lifecycle facts; it does not read Ensen-flow workflow state, approval state, or final RunResult fields. If validation or plan normalization blocks the dry run and valid request/correlation identifiers are available, the command emits a blocked status snapshot with actionable reasons under `extensions.x-ensen-loop-blocked-reasons`.

`x-gate2-smoke <run-request-json-file>` emits the X-Gate 2 narrow loop-flow dry-run smoke payload to stdout. The JSON payload contains deterministic `statusSnapshot`, `runResult`, and `evidenceBundleRef` fields for a valid EIP RunRequest v1 fixture. The EvidenceBundleRef uses a relative local artifact URI under `artifacts/evidence/x-gate2/<request-id>.json`; the command describes that artifact location but does not create or write the artifact. The smoke path does not create a repository, branch, worktree, GitHub issue, pull request, Codex session, durable evidence bundle, or provider call. Invalid RunRequest input and unsupported EIP major versions fail closed with blocked status/result output when stable request and correlation identifiers are available.

EvidenceBundleRef validation is exposed as an Ensen-loop-native protocol helper for copied Ensen-protocol v0.1.0 fixtures and dry-run metadata. It accepts relative traversal-free local paths and absolute `file:///` URIs, rejects credential-shaped URIs, query or fragment-bearing file URIs, traversal, absolute local paths, and ambiguous local path shapes, and keeps validation independent from any Ensen-flow runtime.

## Scope

Ensen-loop must remain independently buildable and testable. EIP RunRequest input support is limited to explicit file validation and dry-run status/result boundaries. RunResult boundary validation and dry-run output are present for fixture compatibility; full RunResult lifecycle support, execution, storage, and durable packaging belong to a later phase.
