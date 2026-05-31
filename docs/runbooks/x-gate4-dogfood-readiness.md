# X-Gate 4 Dogfood Readiness Checklist

This checklist defines the owner-controlled stop/go boundary for X-Gate 4
Ensen-loop dogfood. It is public-safe, repo-local, and operator-readable. It is
not a production evidence claim, customer pilot approval, compliance claim, or
permission to execute against customer repositories.

## Phase 6 Completion Baseline

X-Gate 4 dogfood can only start after the Phase 6 loop-mode baseline is present
in Ensen-loop at main commit `1b28d6e` or newer. The baseline issue set is:

- #109: queue boundary.
- #110: lock boundary.
- #111: status and explain boundary.
- #112: stop boundary.
- #113: retry and requeue boundary.
- #114: stale-state reconciliation, one-shot mode, and continuous loop mode.

The baseline is used as Loop-local readiness evidence only. It does not rely on Ensen-flow runtime state, an Ensen-flow checkout, or any Ensen-flow fixture path.

## Allowed Scope

Only owner-controlled Ensen-loop dogfood repositories are in scope.

- Repository: `TommyKammy/Ensen-loop`.
- Branches: issue branches owned by the operator, such as `codex/issue-122`.
- Paths: repo-relative Ensen-loop source, tests, docs, generated `dist/` output,
  and supervisor issue metadata under `.codex-supervisor/issues/<issue-number>/`.
- Fixtures: repo-owned fixtures under `test/fixtures/` and
  `protocol-snapshots/ensen-protocol/`.
- Lane work items: explicitly selected GitHub issues in the X-Gate 4 child issue
  set, beginning with #122 and continuing only through owner-approved follow-up
  issues.

Every run must keep `ownerControlledOnly` true. GitHub issue pickup facts,
branch names, path shape, nearby metadata, or issue text are not execution
authority by themselves.

## Excluded Scope

The following are out of scope and must remain blocked:

- Customer repositories.
- Regulated data, customer data, ERPNext live connector work, electronic
  signatures, batch release, final disposition, or compliance guarantees.
- Production evidence claims or durable compliance packaging.
- Automatic merge, merge-readiness claims without local verification, or branch
  protection bypass.
- Automatic quality decision, auto-approval, or reviewer substitution.
- Ensen-flow runtime state, Ensen-flow implementation imports, Ensen-flow
  checkouts, Ensen-flow fixture paths, or Ensen-flow services.

## Readiness Checklist

Before a dogfood smoke run, verify all items below:

- Scope names an owner-controlled Ensen-loop repository and an explicit issue
  branch.
- Selected work item is an owner-approved X-Gate 4 child issue and is open.
- Queue contains only owner-controlled dogfood lane records.
- Lock state is clean, current, and tied to the selected work item.
- Status and explain output agree on the selected work item and next operator
  action.
- Stop, retry, and requeue paths have no stale or orphaned durable state from a
  prior failed attempt.
- Stale-state reconciliation has no mixed-snapshot queue or lock evidence.
- One-shot mode is selected for a single operator-selected issue.
- Continuous loop mode is used only for supervised repeated selection over the
  same owner-controlled queue boundary.
- Diagnostics are public-safe and do not expose credentials, raw local
  workstation paths, customer identifiers, or regulated data.

Focused command examples:

```sh
node dist/src/cli/index.js loop-mode one-shot --state-root <state-root> --issue <stable-work-item-id>
node dist/src/cli/index.js loop-mode continuous --state-root <state-root>
```

## Stop Criteria

Stop the dogfood run and record the blocker before continuing when any of these
conditions appear:

- Unsafe diagnostics: redact the output, keep the guard in place, and rerun only
  after the diagnostic source emits public-safe text.
- Ambiguous state: reject readiness when queue, lock, status, explain, journal,
  or selected issue facts disagree and no authoritative lifecycle record resolves
  the winner.
- Unexpected mutation: stop immediately if a command creates or changes a
  branch, commit, pull request, review, issue, worktree, evidence archive, or
  state file outside the expected repo-local boundary.
- Automatic merge: stop if any plan, adapter, artifact, or output claims merge,
  merge readiness, auto-merge, or branch-protection bypass.
- Automatic quality decision: stop if any output claims approval, final quality,
  human-review replacement, or reviewer authority.
- Customer repo execution: stop if any scope, queue record, path, issue, branch,
  or adapter points at a customer repository or a non-owner-controlled target.
- Regulated-data handling: stop if any input or output includes customer data,
  regulated data, ERPNext live connector state, signatures, batch release, final
  disposition, or compliance language.
- Missing prerequisite: block instead of guessing when owner-controlled scope,
  authoritative state, dry-run proof, operator approval, or local verification is
  absent or malformed.

## Go Boundary

Proceed only when the checklist is fully satisfied, the focused loop-mode command
returns owner-controlled public-safe diagnostics, and the operator can explain
the next action without relying on Ensen-flow runtime state. Any partial,
ambiguous, or inferred readiness result is a stop condition.
