# Phase 3 Local Lane Execution Contract

This document defines the Ensen-loop-owned Phase 3 contract for turning a valid
EIP RunRequest v1 into a bounded local lane run. It is a local execution
boundary, not a protocol schema change, not X-Gate 2 smoke output, and not a
production automation claim.

The contract preserves the Ensen-loop vocabulary from the Phase 1 core model:
Work Item, Lane Run, Lane Journal, Durable State, Agent Provider, SCM Provider,
Verification Result, Review Event, and Evidence Bundle. It maps those terms to
the copied Ensen-protocol v0.2.0 RunRequest v1, RunStatusSnapshot, RunResult,
and EvidenceBundleRef shapes without widening those protocol schemas. Protocol
release `v0.2.0` is the copied release lineage; the active EIP artifacts remain
`eip.*.v1` schemas.

## Boundary

Phase 3 local lane execution accepts one validated RunRequest v1, resolves it
into one local Lane Run, and records bounded state transitions without starting
real provider work. The boundary:

- does not invoke an Agent Provider;
- does not create branches, commits, change requests, issues, or reviews;
- may write local development evidence metadata references, but does not write
  a production evidence archive or durable compliance bundle unless a later
  issue explicitly adds that behavior;
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

`prepareLocalLaneWorkspace()` is the Ensen-loop-owned local preparation helper
for one bounded lane run. Callers provide absolute `<workspace-root>` and
`<state-root>` paths, plus a lane run identifier or work item identifier. The
helper derives one stable local directory name, prepares
`<workspace-root>/lane-runs/<lane-id>` and
`<state-root>/lane-runs/<lane-id>`, rejects missing roots, relative roots,
shared workspace/state roots, malformed identifiers, traversal-shaped
identifiers, symlinked roots, and symlink-mediated lane paths, and rolls back
only the lane workspace directory it created if state preparation fails. It does
not start an agent, create SCM state, mutate GitHub, or delete unrelated files.

Examples should use placeholders such as `<workspace-root>`, `<state-root>`,
`<run-request-json-file>`, and `<supervisor-config-path>`.

`planBranchLaneRunSkeleton()` is the dry-run-first Phase 3 helper for
branch/worktree lane intent. It accepts one ready Work Item, one lane run id, one
idempotency key, explicit `<repository-root>`, `<worktree-root>`, and
`<state-root>` paths, an owner-controlled branch name, and an authoritative
repository scope record. The default mode describes the intended branch,
worktree path, state file path, idempotency fact, and provider non-actions
without creating branch, worktree, change request, agent session, or local
provider state.

Dogfood preparation requires a separate owner-controlled repository execution
allowlist. That allowlist is operator-owned configuration, not GitHub issue text
and not Ensen-flow approval state. Each matching entry binds
`ownerIdentity`, `repositorySlug`, `repositoryUrl`, and `<repository-root>` with
`ownerControlled: true`. A missing or mismatched dogfood allowlist blocks before
prepare mode creates lane workspaces, state directories, provider sessions,
branches, pull requests, or agent execution. Diagnostics name the failing
category, such as `ownerIdentity`, `repositorySlug`, `repositoryUrl`, or
`repositoryRoot`, without echoing raw local absolute paths.

GitHub WorkItem pickup has its own read-only allowlist for collecting issue
facts. Those pickup facts can feed the later authoritative scope record, but the
pickup allowlist is not execution authority by itself. Execution-capable dogfood
lanes must still match the dogfood repository allowlist at the local lane
boundary.

Track B customer repository preparation uses a separate customer repository
allowlist. Customer repositories are not owner-controlled dogfood repositories
and must not reuse the dogfood allowlist, GitHub pickup allowlist, issue text, or
path naming conventions as execution authority. Each matching customer entry
must explicitly bind the repository owner, repository name, `<repository-root>`,
purpose, and approval note. Missing, malformed, placeholder, or mismatched
customer policy facts block before prepare mode creates lane workspaces, state
directories, provider sessions, branches, pull requests, or agent execution.
Customer diagnostics name only the failing category, such as `owner`, `repo`,
`repositoryRoot`, `purpose`, or `approvalNote`; they must not echo customer
repository names, domains, local paths, or purpose text into public artifacts.

Customer lane skeleton output and LaneRunState journal entries use sanitized
customer placeholders instead of raw customer repository details. The allowlist
match proves only that the local Track B safety boundary was satisfied for this
bounded preparation step. It is not production-ready customer execution,
regulated workflow support, ERPNext integration, electronic signature handling,
batch release, final disposition, or a compliance guarantee.

Prepare mode is explicit. It creates only the Ensen-loop local lane workspace
and state directories, writes a queued LaneRunState, and records branch intent,
repository scope, idempotency, and cleanup facts in the Lane Journal. It still
does not call Git, create a branch, create a Git worktree, open a change request,
or start an agent. If state persistence fails after local preparation, the
helper removes the prepared lane workspace and state directory for that lane id
and leaves unrelated files untouched. Later cleanup can use the journal cleanup
fact and the lane id to remove the prepared local workspace and state directory.

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
| `blocked` | The local lane run stopped at a missing or unsafe prerequisite with diagnostic reasons preserved. | None |
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

Phase 3 local lane persistence may write Ensen-loop-owned metadata under the
prepared local state path using an EvidenceBundleRef `local_path` URI. That file
records bounded development facts such as lane identifiers, executor outcome,
verification summary, blocked reasons, and the validated reference metadata. It
must not embed raw evidence bodies, secrets, customer data, provider
credentials, workstation-local absolute paths, or production compliance claims.

## Fail-Closed Rules

The executor must block before mutation or terminal success when any of these
signals is missing or unsafe:

- unsupported EIP major versions or unknown protocol shape;
- missing stable identifiers needed for RunRequest, Work Item, target, or
  correlation binding;
- unsafe workspace root or state root resolution;
- missing target binding when repository or workspace execution would depend on
  it;
- missing or mismatched owner-controlled dogfood repository allowlist for
  non-dry-run dogfood lane preparation;
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
