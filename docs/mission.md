# Ensen-loop Mission

Ensen-loop is a provider-independent control plane for AI-agent-driven software development lanes.

It is the successor product to codex-supervisor. Its mission is not to make one agent or one source-control host easier to automate. Its mission is to turn AI-assisted code changes into bounded, test-backed, reviewable, and auditable development lanes that can be operated safely in real repositories.

## North Star

```text
Ensen-loop makes AI coding changes safe, bounded, reviewable, and auditable.
```

Ensen-loop belongs to the Ensen product family:

```text
ensen-protocol defines the public contract.
ensen-loop runs AI development lanes.
ensen-flow orchestrates lightweight explainable workflows.
ensen-flow-pharma provides validation-ready workflow scaffolding for regulated domains.
```

The products cooperate through protocol, schemas, fixtures, compatibility notes, and explicit documentation. They must not cooperate by importing each other's runtime implementation.

## Why Ensen-loop Exists

codex-supervisor proved that AI coding work becomes more useful when it is issue-driven, test-backed, reviewable, and operated with durable evidence. That model should not remain tied to only Codex, GitHub, or one local supervisor implementation.

Ensen-loop exists to preserve the useful control-plane ideas and move them into neutral product vocabulary:

- Work Items instead of only GitHub issues.
- Agent Providers instead of only Codex.
- SCM Providers instead of only GitHub.
- Change Requests instead of only pull requests.
- Verification Results instead of unstructured test claims.
- Review Events instead of one review tool's comment shape.
- Lane Journals, durable state, and Evidence Bundles as first-class artifacts.

The long-term direction is enterprise-ready lane control that can support future providers such as GitLab, GitLab Self-Managed, OpenCode, Claude Code, local agents, restricted networks, and private runners without collapsing those concerns into the core model.

## Charter Commitments

Before implementing a change, preserve the Ensen development charter:

- Protocol over shared implementation.
- Bounded execution over uncontrolled automation.
- Evidence before authority.
- Explainability over magic.
- Validation-ready language over premature compliance claims.

For Ensen-loop, these commitments mean:

- Keep `1 issue = 1 behavior delta` as the default execution unit.
- Keep Ensen-loop usable without Ensen-flow.
- Treat Ensen-flow requests as external protocol input, not trusted internal state.
- Keep GitHub, GitLab, Codex, OpenCode, and future providers behind adapter boundaries.
- Require local verification before publication or merge-readiness claims.
- Preserve human control points for approval, stop, repair, and merge decisions.
- Fail closed when scope, provenance, authorization, verification, review, durable state, or publication state is missing or ambiguous.

## Scope

Ensen-loop owns the development lane lifecycle:

- selecting a runnable Work Item;
- preparing an isolated lane workspace;
- invoking an Agent Provider through an explicit boundary;
- tracking branch, worktree, and Change Request state;
- running local verification and consuming CI status;
- collecting human and tool Review Events;
- recording Lane Journal and durable Lane Run State;
- producing evidence and audit-facing references;
- explaining lane status, blockers, recovery needs, and merge readiness.

## Non-Goals

Ensen-loop must not become:

- a general workflow engine;
- an Ensen-flow runtime;
- a Pharma or GxP workflow pack;
- a GitHub-only or Codex-only tool again;
- an unchecked auto-merge engine;
- a system that trusts agent output without verification and review;
- a product that requires Ensen-flow to build, test, or operate.

Ensen-loop may later consume EIP RunRequest artifacts and emit RunResult, RunStatusSnapshot, EvidenceBundleRef, or AuditEvent-compatible output. That integration must remain protocol-based and optional at the product boundary.

## Development Rules

Important changes should state their charter alignment in the PR or handoff:

```text
## Charter alignment
- Which Ensen-loop goal does this support?
- Does this preserve product boundaries?
- Does this add or preserve evidence/auditability?
- Does this avoid shared runtime dependency?

## Verification
- Commands run
- Fixture/schema validation result, when relevant
- Relevant tests

## Non-goals
- What this change intentionally does not do
```

When a design choice is unclear, prefer a design note, ADR, schema, fixture, or compatibility document before adding runtime behavior.

## Verification Baseline

The repo-owned verification sequence is:

```sh
npm ci
npm run typecheck
npm run build
npm test
```

Future phases may add stronger quality gates, protocol fixture checks, or provider-specific integration tests. When they do, the command, boundary, and evidence expectation should be documented explicitly instead of relying on convention.

