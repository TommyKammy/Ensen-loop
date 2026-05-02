# Dogfood Rollback and Cleanup

This runbook defines owner-controlled cleanup for Ensen-loop dogfood lanes. It
covers local prepared worktrees, branches, patch artifact files, lane state,
journal entries, and evidence references after a lane stops before normal
completion.

It is an operator runbook for local dogfood recovery. It does not automate
remote rollback, merge publication, or pull request cleanup. Preserve the facts
needed to explain what happened unless a section below explicitly marks a safe
deletion boundary.

## Preconditions

Before deleting anything, capture the lane identity and current supervisor
context:

```sh
CODEX_SUPERVISOR_CONFIG=<supervisor-config-path> node dist/index.js status --why
git status --short --branch
```

Use the lane journal, issue id, branch name, worktree path, and evidence
references from the authoritative supervisor state. Do not infer linkage from
similar names, nearby directories, or summary text alone.

If the status command cannot identify the active lane or its workspace, stop and
request operator confirmation before deleting local state.

## Outcome Classification

Classify the lane before cleanup:

- `failed`: execution started and returned an error, test failure, or rejected
  result. Keep the journal, evidence references, and failure details.
- `blocked`: a prerequisite, permission, missing secret, review, or merge
  conflict prevented safe progress. Keep the guard condition and the evidence
  explaining it.
- `no-op`: the lane made no durable repository or lane-state change. Cleanup may
  remove prepared local directories after confirming no untracked work exists.
- `retryable`: the same lane can run again after the prerequisite is repaired.
  Keep the branch, issue journal, lane state, and evidence references.
- `discard`: the operator chooses not to keep local code changes. Preserve the
  journal and evidence references before removing worktree or patch artifact
  files.
- `manual repair`: the operator keeps the branch or worktree for direct edits.
  Do not remove prepared state until repair is complete and recorded.
- `abandon`: the operator ends the lane without retry. Keep audit facts and
  enough state to explain the abandoned run; delete only explicitly disposable
  local artifacts.

## Cleanup Boundaries

| Surface | May delete after confirmation | Must retain | Requires explicit operator confirmation |
| --- | --- | --- | --- |
| Prepared worktree | A dedicated per-lane worktree with a clean `git status --short` output. | Any worktree with unstaged, staged, untracked, or unresolved-conflict changes. | Removing a worktree that has local edits, generated artifacts, or unclear ownership. |
| Branch | A local dogfood branch after its useful patch is committed elsewhere, exported, or intentionally discarded. | Branches with unmerged changes, open review context, or unresolved repair work. | Deleting any remote branch or deleting a branch that is the only copy of work. |
| Patch artifact | Patch files that were superseded by a retained commit or explicitly discarded. | Patch files referenced by the journal, review, evidence, or handoff notes. | Deleting a patch artifact when it is the only durable copy of local changes. |
| Lane state | Temporary retry scaffolding that the supervisor marks disposable. | Authoritative lane records, terminal status, failure reasons, blocked reasons, and retry history. | Removing or editing lane state when status is missing, mixed, or malformed. |
| Journal | Scratchpad notes that the supervisor compacts or marks obsolete. | Issue journal entries, handoff summaries, commands run, failure signatures, and rollback notes. | Editing or truncating journal history outside the documented supervisor workflow. |
| Evidence | Duplicate local scratch files not referenced by any retained record. | Evidence references, checksums, command summaries, review references, and audit facts. | Removing any referenced evidence file, archive pointer, or verification output. |

Fail closed when the boundary is unclear. A missing or malformed provenance
signal means cleanup pauses until the operator supplies the authoritative lane
record or approves a narrower deletion.

## Retry

Use retry when the failure is reproducible and the lane remains useful.

1. Keep the branch, prepared worktree, lane state, issue journal, and evidence
   references.
2. Record the failed or blocked signature in the journal before restarting.
3. Repair only the prerequisite that caused the failure.
4. Restart from the repo-local supervisor entrypoint:

```sh
CODEX_SUPERVISOR_CONFIG=<supervisor-config-path> node dist/index.js loop
```

Do not remove patch artifact files that explain the previous attempt until the
retry produces a newer retained record.

## Discard

Use discard when the operator decides the local changes should not continue.

1. Confirm the issue id, branch, worktree, and lane state from supervisor
   status.
2. Preserve the issue journal and evidence references.
3. Export or retain any patch artifact needed to explain the discarded work.
4. Remove only the confirmed local worktree:

```sh
git worktree remove <lane-worktree-path>
```

5. Delete the local branch only after confirming it is not the only retained copy
   of useful work:

```sh
git branch -d <dogfood-branch>
```

Use `git branch -D <dogfood-branch>` only after explicit operator confirmation
that the branch is intentionally abandoned.

## Manual Repair

Use manual repair when a human will inspect or edit the lane.

1. Keep the worktree, branch, lane state, journal, and evidence references.
2. Mark the lane as manual repair in the handoff or journal.
3. Record the last known failing command and failure signature.
4. Avoid supervisor retries until the repair owner records the next action.

Manual repair may create new patch artifact files or commits. Keep the original
failure evidence linked so later reviewers can distinguish the failed attempt
from the repair.

## Abandon

Use abandon when no retry or repair is intended.

1. Record the abandon decision, reason, branch, worktree, and evidence references
   in the journal.
2. Keep terminal lane state and the evidence needed to explain the abandoned
   run.
3. Remove only disposable local worktrees or patch artifact files after
   confirming they are not referenced.
4. Leave remote branches, pull requests, and published comments untouched unless
   a separate operator instruction covers them.

## Local Command Checklist

Inspect before cleanup:

```sh
CODEX_SUPERVISOR_CONFIG=<supervisor-config-path> node dist/index.js status --why
git status --short --branch
git worktree list
git branch --list <dogfood-branch>
```

Remove only confirmed local artifacts:

```sh
git worktree remove <lane-worktree-path>
git branch -d <dogfood-branch>
rm <patch-artifact-path>
```

Retain or update the journal with the final decision:

```text
Outcome: failed | blocked | no-op | retryable | discard | manual repair | abandon
Retained: <journal-path>, <lane-state-ref>, <evidence-ref>
Deleted: <worktree-ref>, <branch-ref>, <patch-artifact-ref>
Operator confirmation: <confirmation-ref>
```

Do not use broad recursive deletion commands against repository roots,
supervisor roots, shared workspace roots, state roots, or paths whose ownership
is not confirmed by the lane record.
