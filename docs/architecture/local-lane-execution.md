# Phase 3 Local Lane Execution Contract

This document defines the Ensen-loop-owned Phase 3 contract for turning a valid
EIP RunRequest v1 into a bounded local lane run. It is a local execution
boundary, not a protocol schema change, not X-Gate 2 smoke output, and not a
production automation claim.

The contract preserves the Ensen-loop vocabulary from the Phase 1 core model:
Work Item, Lane Run, Lane Journal, Durable State, Agent Provider, SCM Provider,
Verification Result, Review Event, and Evidence Bundle. It maps those terms to
the copied Ensen-protocol v0.1.0 RunRequest v1, RunStatusSnapshot, RunResult,
and EvidenceBundleRef shapes without widening those protocol schemas.

## Boundary

Phase 3 local lane execution accepts one validated RunRequest v1, resolves it
into one local Lane Run, and records bounded state transitions without starting
real provider work. The boundary:

- does not invoke an Agent Provider;
- does not create branches, commits, change requests, issues, or reviews;
- does not write a durable evidence bundle unless a later issue explicitly adds
  that behavior;
- does not require Ensen-flow code, services, packages, fixtures, local paths,
  or runtime state;
- treats every RunRequest field as external protocol input, not internal
  authority.

The local executor may normalize intent and persist Ensen-loop-owned state. It
must not infer authorization, repository binding, tenant identity, workspace
trust, or completion from GitHub text, source naming conventions, path shape, or
nearby metadata.

## Inputs

The local execution input is a RunRequest v1 value that already passed the
Ensen-loop RunRequest validation boundary. A request is executable only when it
has the stable identifiers needed to create an auditable local run:

- `id` for the request identity;
- `correlationId` for cross-surface correlation;
- `idempotencyKey` for duplicate request handling;
- `source.sourceId` and `source.sourceType` for provenance hints;
- `workItem.workItemId` and `workItem.externalId` for the Work Item binding;
- `target.targetId` when workspace or repository scope is required;
- `policyContext` when policy posture affects execution eligibility.

RunRequest `source`, `workItem.url`, `target.externalRef`, `extensions`, and
policy fields are bounded input facts. They may be copied into derived surfaces
for reviewability, but they remain `trustedAuthority: false` unless a later
Ensen-loop boundary binds them to an authoritative scope record.

Unsupported EIP major versions fail closed at the protocol input boundary. If a
future protocol contract is needed before Ensen-loop can interpret an input
safely, route that gap through TommyKammy/Ensen-protocol#28 before widening
Loop behavior.

## Local Roots

Phase 3 execution uses caller-provided roots:

- a workspace root for local lane files;
- a state root for LaneRunState records;
- optional artifact roots for future evidence or review outputs.

These roots must be explicit runtime inputs or documented environment variables,
not workstation-local path literals in public examples. The executor must reject
missing, ambiguous, traversal-bearing, or symlink-mediated workspace root and
state root resolution. A path that cannot be proven to stay inside the intended
root is unsafe and must block the run before durable state or filesystem
mutation occurs.

Examples should use placeholders such as `<workspace-root>`, `<state-root>`,
`<run-request-json-file>`, and `<supervisor-config-path>`.

## State Transitions

LaneRunState is the authoritative lifecycle record for local lane execution.
Derived status text, detail DTOs, logs, and handoff notes must be rebuilt from
LaneRunState, not treated as independent truth.

The Phase 3 local lane state machine is:

| State | Meaning | Provider or SCM side effects |
| --- | --- | --- |
| `queued` | The RunRequest is valid and has been accepted into local LaneRunState. | None |
| `running` | Ensen-loop is normalizing scope, journal entries, and bounded execution intent. | None |
| `verifying` | Repo-owned verification commands are selected or recorded. | None by default |
| `reviewing` | Reviewable local output is ready for human or tool inspection. | None by default |
| `completed` | The local lane run reached a clear terminal success outcome. | None unless a later issue adds an explicit adapter |
| `failed` | The local lane run reached a clear terminal failure outcome. | None |

Ambiguous executor outcome is not success. If the executor cannot determine
whether normalization, verification, evidence capture, or persistence completed,
it must keep the guard in place and surface `blocked` or `failed` output instead
of inventing a completed state.

## Protocol Surface Mapping

RunStatusSnapshot is the polling surface. It may report accepted, queued,
running, blocked, failed, or completed local lane facts derived from
LaneRunState. A blocked snapshot must include actionable blocked reasons under
an Ensen-loop extension key when stable request and correlation identifiers are
available.

RunResult is the terminal surface. It may be emitted only after the local lane
has a terminal authoritative outcome. `succeeded`, `failed`, and `blocked` must
reflect the LaneRunState lifecycle and verification/evidence facts that
Ensen-loop actually owns. A terminal result must not claim provider execution,
remote mutation, production deployment, or compliance packaging that did not
happen.

EvidenceBundleRef is reference metadata. It can point to a future artifact
location only when the URI or path is traversal-free, secret-safe, and scoped to
the documented local artifact root. An EvidenceBundleRef does not by itself
prove that a durable evidence bundle exists.

## Fail-Closed Rules

The executor must block before mutation or terminal success when any of these
signals is missing or unsafe:

- unsupported EIP major versions or unknown protocol shape;
- missing stable identifiers needed for RunRequest, Work Item, target, or
  correlation binding;
- unsafe workspace root or state root resolution;
- missing target binding when repository or workspace execution would depend on
  it;
- missing policy context when policy posture is required for execution;
- missing or malformed verification command evidence;
- ambiguous executor outcome;
- evidence references that contain credentials, raw secrets, traversal, query
  strings, fragments, or workstation-local paths;
- any protocol contract gap that needs Ensen-protocol clarification before Loop
  can interpret it safely.

Rejected paths must leave no orphan LaneRunState, partial durable write, or
half-created artifact. When a failure occurs after a state record exists, the
next record must explicitly show the authoritative failed or blocked lifecycle
fact rather than relying on a log line.

## X-Gate 2 And Production Boundaries

X-Gate 2 smoke output is a narrow dry-run compatibility surface. It proves that
Ensen-loop can validate protocol inputs and emit deterministic status/result
examples without invoking providers or mutating repositories. Phase 3 local lane
execution is broader because it introduces Ensen-loop-owned LaneRunState and
local lifecycle ownership, but it is still bounded local execution.

Production automation is a later adapter concern. Real Agent Provider calls,
SCM mutation, remote issue or change-request mutation, CI polling, durable
evidence packaging, and merge-readiness decisions require explicit future
contracts, tests, and operator controls.

## Verification Expectations

Child issues implementing this contract should add the narrowest regression
test at the owning boundary before broad implementation. Useful checks include:

- invalid RunRequest input produces blocked RunStatusSnapshot and RunResult
  output when stable identifiers are available;
- local root validation rejects unsafe workspace root and state root paths
  before writes;
- LaneRunState remains the authoritative source for current status;
- ambiguous executor outcome cannot emit a successful RunResult;
- EvidenceBundleRef examples remain path-safe and secret-safe.

The repo-owned verification sequence remains:

```sh
npm run typecheck
npm run build
npm test
```
