# Phase 4 Provider Capability Boundaries

This document defines the provider-neutral boundary for the first Ensen-loop
dogfood slice. The boundary is intentionally capability-shaped: core lane logic
describes intent and required capability, while concrete adapters decide how a
provider satisfies that capability.

## SCMProvider Capabilities

| Capability | Core lane meaning | Adapter responsibility |
| --- | --- | --- |
| `work-item-pickup` | Select or normalize a Work Item for lane execution from explicit scope. | Translate a provider issue, ticket, or manual record into Ensen-loop Work Item vocabulary. |
| `lane-branch-intent` | Describe the branch name or branch policy needed for a Lane Run. | Create, find, or update the provider-native branch only when an adapter is explicitly invoked. |
| `lane-worktree-intent` | Describe the workspace checkout intent needed for bounded execution. | Prepare provider-specific clone, worktree, checkout, or repository state outside core lane logic. |
| `change-request-intent` | Describe the review artifact that should represent a Change Request. | Open or update a pull request, merge request, patch review, or equivalent provider-native object. |
| `status-reporting` | Describe lane status that may be reported externally. | Publish provider-native issue comments, checks, labels, commit statuses, or summaries. |

Core lane logic may store these capability names and intent records. It must not
call a provider API, `gh`, Git commands that mutate a remote, or another
provider-specific CLI directly.

## AgentProvider Capabilities

| Capability | Core lane meaning | Adapter responsibility |
| --- | --- | --- |
| `dry-run-intent` | Describe what an agent session would do without starting one. | Return deterministic planning metadata or adapter-specific preview output. |
| `execute-intent` | Describe an approved execution request for a bounded Lane Run. | Start, monitor, and summarize a real provider session only at the adapter boundary. |

Core lane logic may decide that a Lane Run needs dry-run or execute capability.
It must not start provider sessions, shell out to provider commands, or encode
provider-specific command arguments as core model vocabulary.

## Codex AgentProvider Boundary

The Phase 4 Codex adapter boundary publishes operation-level capability evidence
against protocol `v0.2.0` before any operation is treated as available:

| Operation | Support level | Boundary behavior |
| --- | --- | --- |
| `submit` | `supported` | May be planned as the execute-capable boundary only after explicit execute posture, repo-relative workspace, owner-controlled scope, and idempotency binding are present. |
| `status` | `partial` | Must fail closed for authoritative status polling; partial Codex observations are diagnostics, not RunStatusSnapshot truth. |
| `cancel` | `unsupported` | Must fail closed and must not mark a lane run cancelled without an authoritative cancellation boundary. |
| `fetchEvidence` | `partial` | May describe references or diagnostics, but must not claim durable evidence fetch support. |
| `polling` | `partial` | Must not fabricate polling support or infer lifecycle state from Codex naming or operator text. |
| `evidenceReferences` | `supported` | May publish sanitized evidence-reference facts without raw evidence bodies, secrets, or host-local absolute paths. |
| `idempotency` | `supported` | Required for execute intent before `submit` can be considered ready. |

The copied protocol snapshot includes public-safe capability variant examples at
`protocol-snapshots/ensen-protocol/v0.2.0/fixtures/capability-variants/v1/valid/`.
Those examples are `eip.capability-variant.example.v1` guidance for provider
boundary checks; they do not rename RunRequest, RunStatusSnapshot, RunResult, or
EvidenceBundleRef artifacts to `v2`.

Dry-run remains the default Codex intent. It describes the adapter invocation and
records capability evidence without starting a Codex session. Execute intent is a
separate guarded fact surface; it is still represented without starting a
provider session until a later invocation layer owns that side effect.

## Dogfood Adapter Positions

The first dogfood slice can use a GitHub adapter for SCMProvider behavior and a
Codex adapter for AgentProvider behavior. Those names identify initial adapter
positions, not core concepts. The core model remains the same if later adapters
bind the same capability names to GitLab, OpenCode, Claude Code, or a local
manual provider.

Future providers stay visible by reserving capability names rather than
implementation hooks. Adding a provider should add an adapter that declares
which existing capabilities it satisfies, or a new provider-neutral capability
with tests and docs explaining why the existing vocabulary is insufficient.

## Core Lane Versus Adapter Logic

Provider-neutral core lane logic:

- validates Work Item, Lane Run, and Change Request intent;
- records provider capability requirements;
- keeps dry-run and execute intent separate;
- records status that can be projected to external systems;
- fails closed when scope, provenance, auth, or durable state is missing.

GitHub/Codex adapter logic:

- authenticates to the provider;
- maps provider-native issue, branch, worktree, pull request, status, and session
  objects to Ensen-loop vocabulary;
- invokes provider APIs or CLIs;
- handles provider-specific retry, rate limit, and permission failures.

This repository remains independently buildable and testable. It does not import
or require an Ensen-flow runtime, checkout, service, package, or fixture to
define these boundaries.
