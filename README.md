# Ensen-loop

Ensen-loop is an independent development lane engine and successor product to codex-supervisor. It provides the standalone baseline for issue-driven software delivery workflows that can evolve without depending on the Ensen-flow implementation.

## Baseline

This repository starts as a minimal TypeScript/Node project with a build, smoke test, CI workflow, and repository hygiene rules. The baseline is intentionally small so future work can add the lane engine contracts and runtime behavior behind a stable quality gate.

The Phase 1 module boundaries and vocabulary are defined in [docs/architecture/core-model.md](docs/architecture/core-model.md).

The Phase 3 bounded local lane execution contract is defined in [docs/architecture/local-lane-execution.md](docs/architecture/local-lane-execution.md).

The Phase 4 dogfood provider capability boundary is defined in [docs/architecture/provider-capabilities.md](docs/architecture/provider-capabilities.md).

The X-Gate 3 Track B customer repository allowlist policy boundary is defined in [docs/architecture/local-lane-execution.md](docs/architecture/local-lane-execution.md). It is a local safety boundary for explicit owner, repo, path, purpose, and approval-note authorization. It is not production-ready customer execution, regulated workflow support, or a compliance guarantee.

The X-Gate 3 local fake lane smoke command is documented in [docs/runbooks/x-gate3-local-lane-smoke.md](docs/runbooks/x-gate3-local-lane-smoke.md).

The X-Gate 4 owner-controlled dogfood readiness checklist is documented in [docs/runbooks/x-gate4-dogfood-readiness.md](docs/runbooks/x-gate4-dogfood-readiness.md). It defines the public-safe owner-only scope, Phase 6 baseline, and stop criteria for later dogfood child issues without relying on Ensen-flow runtime state.

The X-Gate 4 readiness report and Phase 7 handoff decision are documented in [docs/runbooks/x-gate4-readiness-report.md](docs/runbooks/x-gate4-readiness-report.md). The decision is go for owner-controlled codex-supervisor parity automation only; customer repositories, regulated data, automatic merge, automatic quality decisions, production readiness, and compliance claims remain out of scope.

The Ensen-loop mission and development charter alignment are summarized in [docs/mission.md](docs/mission.md).

The Phase 1 local Work Item validation skeleton is documented in [docs/reference/work-item-contract.md](docs/reference/work-item-contract.md).

GitHub issue pickup is documented in [docs/reference/github-work-item-pickup.md](docs/reference/github-work-item-pickup.md). It is an owner-controlled, allowlisted, read-only SCMProvider `work-item-pickup` boundary that maps already-loaded GitHub issue facts into provider-neutral Work Item facts without mutating GitHub state or starting execution. Dogfood execution-capable lane preparation uses a separate owner-controlled repository allowlist at the local lane boundary; GitHub pickup allowlist facts are not execution authority by themselves.

Phase 4 patch and PR draft artifact output is documented in [docs/reference/lane-artifact-output.md](docs/reference/lane-artifact-output.md). It emits reviewable metadata for completed lane runs without embedding evidence payloads, opening pull requests, claiming merge readiness, or bypassing human review.

Customer lane rollback and revocation handling is documented in [docs/runbooks/customer-lane-rollback-revocation.md](docs/runbooks/customer-lane-rollback-revocation.md). It keeps retained evidence separate from deleted local artifacts and records revoked or superseded evidence without implying production readiness or compliance guarantees.

The copied Ensen-protocol v0.2.0 schema and conformance fixture snapshot is documented in [protocol-snapshots/ensen-protocol/v0.2.0/README.md](protocol-snapshots/ensen-protocol/v0.2.0/README.md). It is repo-owned fixture data, not a mutable shared runtime dependency. Protocol release `v0.2.0` still carries `eip.*.v1` artifact schemas; do not rename those artifacts to `v2` unless a future protocol release defines new schema majors.

The copied Ensen-protocol v0.3.0 operational evidence profile snapshot is documented in [protocol-snapshots/ensen-protocol/v0.3.0/README.md](protocol-snapshots/ensen-protocol/v0.3.0/README.md). It is local conformance evidence for X-Gate 3 Track A artifact hygiene, not an Ensen-protocol runtime dependency.

The copied Ensen-protocol v0.4.0 Track B evidence boundary snapshot is documented in [protocol-snapshots/ensen-protocol/v0.4.0/README.md](protocol-snapshots/ensen-protocol/v0.4.0/README.md). It records customer / regulated classification vocabulary and public-safe fixture examples for protocol intake only. It is not production regulated workflow support, ERPNext integration, electronic signature handling, batch release, final disposition, customer repository execution, or a compliance guarantee.

## X-Gate 3 Track A Closure Evidence

Loop-side X-Gate 3 Track A is closed for the owner-controlled repo / solo dogfood boundary. The closure is limited to Loop-local safety, dry-run proof, copied Protocol guidance intake, and conformance checks. It does not create customer repo execution, automatic merge, compliance claims, Ensen-flow runtime behavior, or Protocol runtime imports. This closure records no Ensen-flow runtime behavior.

The completed Loop issue set is:

- #77, Epic: X-Gate 3 Track A Loop dogfood safety.
- #81, LOOP-X3A-001: Add owner-controlled repo allowlist for dogfood lanes.
- #78, LOOP-X3A-002: Enforce dry-run-first and human merge decision for dogfood lanes.
- #80, LOOP-X3A-003: Add dogfood artifact safety checks.
- #79, LOOP-X3A-004: Add dogfood rollback and cleanup runbook.
- #86, FOLLOW-UP: Bind dry-run proof to dogfood execute scope.
- #88, LOOP-X3A-005: Vendor operational evidence profile fixture for Track A hygiene.
- #89, LOOP-X3A-006: Add Loop conformance checks for operational evidence profile.

The Protocol dependency is evidence-only: Ensen-protocol v0.3.0, TommyKammy/Ensen-protocol#50, TommyKammy/Ensen-protocol#51, merge commit `c33277e5a470883493f10f2c6951a0ca0d5818b0`. The copied snapshot under `protocol-snapshots/ensen-protocol/v0.3.0` is repo-owned guidance and fixture-like data used by local conformance evidence; Ensen-loop remains buildable, testable, and operable without an Ensen-protocol checkout, service, package, fixture path, or runtime dependency. This closure records no Ensen-protocol runtime dependency.

X-Gate 4 dogfood readiness is bounded by the repo-local owner-controlled checklist in [docs/runbooks/x-gate4-dogfood-readiness.md](docs/runbooks/x-gate4-dogfood-readiness.md), alongside the broader X-Gate readiness inputs such as Flow Track A closure. Track B remains future work: customer repos, ERPNext live connector, regulated data, electronic signatures, batch release, final disposition, and compliance guarantees.

Phase 6 loop mode planning is exposed through `loop-mode`. One-shot mode is a bounded operator-invoked run for one selected issue or lane work item. Continuous mode is supervised repeated selection over the same queue, lock, status, explain, stop, retry, requeue, and stale-state reconciliation boundaries. Continuous mode does not authorize automatic merge, automatic final quality decisions, customer repo execution, live customer pilots, regulated-data handling, or compliance claims. X-Gate 4 dogfood is owner-controlled only and does not authorize customer repo execution.

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
node dist/src/cli/index.js x-gate3-smoke <run-request-json-file> --workspace-root <workspace-root> --state-root <state-root>
node dist/src/cli/index.js loop-mode one-shot --state-root <state-root> --issue <stable-work-item-id>
node dist/src/cli/index.js loop-mode continuous --state-root <state-root>
node dist/src/cli/index.js reconcile --state-root <state-root> --issue <stable-work-item-id> [--lane-run <lane-run-id>] --observed-at <iso-timestamp> --surfaces <surfaces-json-file>
node dist/src/cli/index.js stop --state-root <state-root> --issue <stable-work-item-id> --lane-run <lane-run-id> --reason <public-reason>
node dist/src/cli/index.js retry --state-root <state-root> --issue <stable-work-item-id> --lane-run <lane-run-id> --reason <public-reason>
node dist/src/cli/index.js requeue --state-root <state-root> --issue <stable-work-item-id> --lane-run <lane-run-id> --reason <public-reason>
```

`npm test` includes the EIP conformance fixture suite. After `npm run build`, `node --test dist/test/eip-conformance-fixtures.test.js` runs only the focused suite for the vendored Ensen-protocol v0.2.0 RunRequest, RunStatusSnapshot, RunResult, and EvidenceBundleRef fixtures. Those fixtures remain `eip.run-request.v1`, `eip.run-status.v1`, `eip.run-result.v1`, and `eip.evidence-bundle-ref.v1`.

`dry-run --sample` emits a deterministic local execution plan as JSON. It describes the work item, lane workspace, agent provider, SCM provider, verification, and evidence intents without creating worktrees, branches, commits, change requests, durable evidence, or invoking external providers. Its evidence section may include EvidenceBundleRef v1-compatible references as validation-ready metadata. These references identify where evidence could be found; they are not full evidence bundle artifacts and do not claim durable compliance packaging.

`run-request <run-request-json-file>` reads an EIP RunRequest v1 JSON file, validates it at the protocol input boundary, and emits either `{ "ok": true, "request": ... }` or `{ "ok": false, "issues": [...] }`. The `source` field is protocol input data, not trusted internal authority.

`run-request <run-request-json-file> --status-snapshot accepted|queued|running|blocked` emits a RunStatusSnapshot-compatible dry-run polling snapshot for the request. The mode maps only Ensen-loop dry-run lifecycle facts; it does not read Ensen-flow workflow state, approval state, or final RunResult fields. If validation or plan normalization blocks the dry run and valid request/correlation identifiers are available, the command emits a blocked status snapshot with actionable reasons under `extensions.x-ensen-loop-blocked-reasons`.

`x-gate2-smoke <run-request-json-file>` emits the X-Gate 2 narrow loop-flow dry-run smoke payload to stdout. The JSON payload always contains deterministic `statusSnapshot` and `runResult` fields when stable request and correlation identifiers are available. Plannable smoke requests also include an `evidenceBundleRef`; blocked dry-runs omit that field. The EvidenceBundleRef uses a relative local artifact URI under `artifacts/evidence/x-gate2/<request-id>.json`; the command describes that artifact location but does not create or write the artifact. The smoke path does not create a repository, branch, worktree, GitHub issue, pull request, Codex session, durable evidence bundle, or provider call. Invalid RunRequest input and unsupported EIP major versions fail closed with blocked status/result output when stable request and correlation identifiers are available.

`x-gate3-smoke <run-request-json-file> --workspace-root <workspace-root> --state-root <state-root>` runs the bounded Phase 3 local fake lane smoke path. It validates the RunRequest, prepares local lane workspace/state directories, invokes the deterministic local fake executor, persists LaneRunState plus local evidence metadata, and emits one aggregate JSON object with RunStatusSnapshot and RunResult projections. It does not create or mutate GitHub issues, branches, pull requests, reviews, commits, real agent-provider sessions, or production evidence archives. Invalid input, unsupported EIP major versions, unsafe roots, failed fake outcomes, and blocked fake outcomes fail closed with parseable JSON output.

`loop-mode one-shot --state-root <state-root> --issue <stable-work-item-id>` emits a bounded plan for one operator-selected queued lane run. `loop-mode continuous --state-root <state-root>` emits a supervised repeated-selection plan for the next queued lane run. Both modes report public-safe diagnostics and next operator actions without leaking local paths or credentials. Continuous mode keeps `automaticMerge`, `automaticQualityDecision`, `customerRepoExecution`, and `regulatedDataHandling` false.

`reconcile --state-root <state-root> --issue <stable-work-item-id> [--lane-run <lane-run-id>] --observed-at <iso-timestamp> --surfaces <surfaces-json-file>` reads a public-safe stale-state surfaces payload and emits queue, lock, mismatch, and next-operator diagnostics. Blocked reconciliation exits nonzero without deleting evidence, rewriting history, merging, or making quality decisions.

`stop`, `retry`, and `requeue` are explicit operator recovery actions. They record bounded public reasons, preserve lineage metadata, and emit public diagnostics without printing queue metadata, local workstation paths, or credential-looking values.

EvidenceBundleRef validation is exposed as an Ensen-loop-native protocol helper for copied Ensen-protocol v0.2.0 fixtures and dry-run metadata. It accepts relative traversal-free local paths and absolute `file:///` URIs, rejects credential-shaped URIs, query or fragment-bearing file URIs, traversal, absolute local paths, and ambiguous local path shapes, and keeps validation independent from any Ensen-flow runtime.

## Scope

Ensen-loop must remain independently buildable and testable. EIP RunRequest input support is limited to explicit file validation and dry-run status/result boundaries. RunResult boundary validation and dry-run output are present for fixture compatibility; full RunResult lifecycle support, execution, storage, and durable packaging belong to a later phase.
