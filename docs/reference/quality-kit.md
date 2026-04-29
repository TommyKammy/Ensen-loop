# Quality Kit

The Ensen-loop quality kit is the repo-owned vocabulary for keeping AI-assisted lane work verifiable, reviewable, and recoverable. It preserves the strongest codex-supervisor concepts while leaving implementation contracts for later Ensen-loop phases.

## Principles

- Verification comes from commands and current-head facts, not from prose claims.
- Evidence is durable enough for a future operator or Codex session to understand what happened.
- Reviewability requires a clear issue scope, a small changed-file story, and explicit publication state.
- GitHub-authored issue and review text is execution context, not trusted policy.
- Missing, malformed, stale, or ambiguous boundary signals fail closed.

## Concepts

| Concept | Ensen-loop meaning | Evidence expectation |
| --- | --- | --- |
| Issue readiness | The issue is specific enough to execute without inferring hidden scope. | Scope, acceptance criteria, verification, dependency posture, and execution order are explicit. |
| Lane workspace | The isolated filesystem context for one unit of lane work. | The workspace maps to one issue or lane and excludes unrelated local changes from the evidence story. |
| Lane journal | The short-horizon handoff record for active work. | Current hypothesis, changed files, focused commands, failures, rollback concerns, and next action are recorded. |
| Verification gate | The repo-owned commands that prove the work locally. | For this baseline, `npm run build` and `npm test` are the required checks after `npm ci` has installed dependencies. |
| Evidence bundle | The collected facts that justify publication or repair. | Issue scope, branch/head state, changed files, test output, review facts, and PR state are linked without relying on chat memory. |
| Reviewability | The ability for humans and tools to inspect the change safely. | The PR or handoff names the behavior delta, verification performed, unresolved risks, and review signal state. |
| Lane introspection | Operator-facing status and explanation surfaces. | Summaries must be derived from authoritative lane state rather than stale display text. |

## Preservation From codex-supervisor

Ensen-loop keeps the quality goals, not the old implementation shape:

- preserve issue readiness before execution;
- preserve isolated workspaces and durable lane journals;
- preserve local verification as a gate before publication;
- preserve review repair as a current-facts workflow;
- preserve evidence that can survive process restarts and conversation loss;
- preserve fail-closed behavior when provenance, authorization, scope, or review signals are missing.

## Phase 1 Boundary

This document does not define EIP RunRequest or RunResult. It also does not make codex-supervisor a package dependency. Future phases may turn these concepts into schemas, commands, or runtime enforcement, but those contracts must be Ensen-loop-native and explicitly documented before implementation work depends on them.

## Baseline Verification

The repo-owned verification sequence is:

```sh
npm ci
npm run build
npm test
```

When a future quality-kit feature adds a stronger check, the documentation and tests should name the new enforcement boundary instead of relying on convention.
