# Issue Readiness Evaluation

Issue readiness evaluation is a pre-execution diagnostic boundary for deciding
whether a mapped WorkItem is bounded enough to become a lane run input. It reads
provider-neutral WorkItem facts, owner-controlled scope facts, and observable
issue structure supplied by a pickup adapter.

The boundary returns one of three parseable states:

| State | Meaning |
| --- | --- |
| `runnable` | The WorkItem is ready, scope is owner-controlled, and the issue describes one bounded behavior delta with acceptance criteria. |
| `blocked` | A fail-closed prerequisite is missing or unsafe, such as owner-controlled scope, supported capability, supported EIP major version, trusted evidence, or an unambiguous open state. |
| `needs-human-refinement` | The issue is not unsafe, but it needs explicit human cleanup before a lane run, such as acceptance criteria or exactly one observable behavior delta. |

## Lint Signals

The `1 issue = 1 behavior delta` lint is based on observable issue structure
after pickup maps provider input into neutral facts. A runnable issue must expose
exactly one behavior delta. Multiple deltas are blocked because the lane could
otherwise perform unrelated changes under one WorkItem. Missing deltas require
human refinement because the intended behavior change is underspecified.

Readiness diagnostics are safe for public artifacts. They identify fields and
categories without echoing raw secrets, credentials, or workstation-local
absolute paths.

## Protocol Boundary

Readiness is not execution. It does not create a worktree, start an agent,
submit a protocol request, emit status snapshots, cancel a run, fetch evidence,
synthesize RunResult output, or make merge decisions.

Protocol `v0.2.0` guidance is reflected as fail-closed diagnostic categories for
validation failure, unsupported capability, provider rejection before run
binding, unavailable evidence, unknown failure, and unsupported EIP major
versions. These diagnostics are advisory inputs for a later lane boundary; they
are not protocol terminal artifacts.

## Non-Goals

- No automatic issue rewriting.
- No compliance claims.
- No protocol terminal artifact synthesis.
- No automatic product, execution, or merge authority.
- No dependency on Ensen-flow approval or workflow state.

