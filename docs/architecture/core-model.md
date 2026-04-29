# Ensen-loop Core Model

This document defines the Phase 1 module boundaries and core vocabulary for Ensen-loop. The model is intentionally small: it names the stable concepts future lane behavior can build on without requiring Ensen-flow, GitHub, Codex, or a predecessor runtime.

## Module Boundaries

| Module | Responsibility |
| --- | --- |
| `src/core/` | Shared model terms and simple TypeScript contracts that other Phase 1 modules can reference. |
| `src/lane/` | Lane run lifecycle, lane journal ownership, and durable lane state surfaces. |
| `src/work-item/` | Work item and change request vocabulary before any provider-specific issue or pull request adapter exists. |
| `src/scm/` | Source-control provider boundary. Provider implementations are future adapters, not core requirements. |
| `src/agent/` | Agent provider boundary. Executor and assistant implementations are future adapters, not core requirements. |
| `src/verification/` | Verification result vocabulary for repo-owned commands and check outcomes. |
| `src/review/` | Review event vocabulary for human or tool review signals. |
| `src/audit/` | Audit-facing durable state and journal surfaces. |
| `src/evidence/` | Evidence bundle vocabulary tying work, verification, review, and notes into a reviewable handoff. |

These modules may share the small contracts from `src/core/`, but the core model must not import implementation code from product-specific adapters.

## Core Terms

| Term | Definition |
| --- | --- |
| Work Item | A unit of lane work selected for execution. It has a stable identifier, title, source, and lifecycle status, but it is not tied to a specific issue tracker. |
| Change Request | A proposed source change produced for a Work Item. It can later map to a pull request, patch, or another SCM-native review object through an adapter. |
| Agent Provider | A boundary for an implementation that can perform lane work. The core model only requires an identifier and display name. |
| SCM Provider | A boundary for source-control operations. The core model does not require any specific host, token, repository service, or remote API. |
| Verification Result | The outcome of a repo-owned verification command or check, including the command, outcome, and summary. |
| Review Event | A review signal attached to a Change Request, such as a comment, approval, requested change, or dismissal. |
| Lane Journal | The short-horizon record for current lane work: hypothesis, commands, failures, changes, and next action. |
| Durable State | Persisted lane facts that survive process restarts and future sessions. Derived summaries must not redefine this state. |
| Evidence Bundle | The reviewable collection of work scope, verification results, review facts, and notes used to justify publication or repair. |
| Lane Run | One execution attempt for a Work Item through lane states such as queued, running, verifying, reviewing, completed, or failed. |

## Lane Journal and Durable State

Phase 1 represents lane run resumability as a local JSON state file under a caller-provided state root. The concrete schema is documented in `schemas/lane-run.schema.json`.

A Lane Run State record is the durable owner for one lane attempt. It stores the lane run identifier, work item binding, lifecycle status, revision, timestamps, and `startsAgentExecution: false` to make clear that this skeleton does not invoke an agent or start runtime execution.

The Lane Journal is embedded in the Lane Run State for Phase 1. It records short-horizon operator context as typed entries: hypothesis, command, failure, change, and next-action. The journal is resumability context, not an authorization source and not an execution trigger.

Audit and evidence surfaces are represented as explicit reference lists on the Lane Run State:

- `audit.eventRefs` reserves the relationship to future audit events without emitting a full EIP AuditEvent.
- `evidence.bundleRefs` reserves the relationship to future evidence bundles without emitting a full EvidenceBundleRef.

Local storage helpers must resolve lane run state paths below a real configured state root, reject lane run identifiers containing path separators or traversal syntax, and fail closed when existing storage components are symbolic links. Derived summaries, detail projections, or operator-facing notes must be rebuilt from the Lane Run State instead of redefining the durable status.

## Provider Posture

GitHub and Codex are future adapter examples, not core model requirements. A future GitHub adapter may bind Work Items to issues and Change Requests to pull requests. A future Codex adapter may satisfy the Agent Provider boundary. Neither adapter is required for this repository to build, test, or explain its Phase 1 model.

## Independence Rules

- Ensen-loop must remain independently installable, buildable, and testable with `npm ci`, `npm run build`, and `npm test`.
- Ensen-loop must not import implementation code from another Ensen product.
- Integration with external products, services, or local checkouts must be optional and documented at an explicit adapter boundary.
- Missing or malformed provenance, scope, auth context, verification, review, or durable state signals must fail closed in the module that owns the boundary.

## Deferred Protocol Work

This Phase 1 core model does not define later protocol request or result schemas. That work belongs in a later phase that defines protocol contracts and the enforcement boundary before runtime behavior depends on them.
