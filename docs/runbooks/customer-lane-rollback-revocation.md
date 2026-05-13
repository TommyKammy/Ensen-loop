# Customer Lane Rollback and Revocation

This runbook defines customer lane rollback and revocation handling for
Ensen-loop customer repository lanes. It covers worktree cleanup, branch
cleanup, draft PR cleanup, local artifact handling, retained evidence, and
deleted local artifacts after a customer lane attempt fails, is mistaken, is
revoked, or is superseded.

This is an operator-controlled local runbook. It does not create production
readiness, production readiness evidence, regulated workflow support, external
write-back behavior, or a compliance guarantee. Customer artifact retention
decisions remain controlled by the operator and the customer's own retention
boundary.

## Preconditions

Before deleting or revoking anything, capture the authoritative lane identity:

```sh
npm run build
node dist/src/cli/index.js run-request <run-request-json-file>
git worktree list --porcelain
git -C <customer-lane-worktree-path> status --short --branch
```

Use the authoritative LaneRunState, lane journal, issue id, branch, worktree
path, draft PR reference, local artifact references, and evidence references.
Do not infer customer, repository, account, lane, or evidence linkage from
names, directory shape, comments, issue text, or nearby summaries.

Ensen-loop currently exposes the documented `dry-run`, `run-request`,
`x-gate2-smoke`, and `x-gate3-smoke` CLI commands through
`dist/src/cli/index.js`. It does not expose a `status`, `loop`, or cleanup
command. If the retained lane state, journal, or worktree path cannot identify
the target customer lane, stop cleanup and request operator confirmation.
Missing scope, provenance, approval, or classification signals fail closed.

## Operator Decision Points

Classify the lane before cleanup:

- `retry`: keep the lane state and local work so the same customer lane can run
  again after a prerequisite is repaired.
- `abandon`: end the attempt without retry while retaining audit facts and
  evidence references needed to explain the decision.
- `manual repair`: keep the worktree, branch, draft PR, artifacts, and evidence
  references for direct human inspection or edits.
- `revoke`: record that a previously retained approval, draft intent, or
  evidence reference was withdrawn by the authoritative operator boundary.
- `supersede`: record that a newer lane attempt, proposal, approval record, or
  evidence reference replaces the older one for future handling.

Do not use rollback as silent deletion. A failed, mistaken, revoked, or
superseded lane still needs retained evidence sufficient to explain what
happened and why the older result is no longer active.

## Retention Boundary

| Surface | Deleted local artifacts allowed after confirmation | Retained evidence required |
| --- | --- | --- |
| Worktree cleanup | Dedicated per-lane worktrees with clean `git status --short` output and confirmed ownership. | Lane id, issue id, worktree reference, deletion decision, operator confirmation, and any failure or revocation reason. |
| Branch cleanup | Local customer lane branches whose useful changes are committed elsewhere, exported, superseded, or intentionally abandoned. | Branch name, commit or patch reference when one existed, terminal lane decision, and evidence explaining why deletion was allowed. |
| Draft PR cleanup | Closing or deleting a draft PR only under the repository host's normal review controls and only after operator confirmation. | Draft PR reference, closure reason, retained review comments, evidence references, and whether the PR was revoked or superseded. |
| Local artifact handling | Disposable generated files that are not referenced by a retained lane record, journal, review, or evidence reference. | EvidenceBundleRef ids, checksums when available, command summaries, retained patch metadata, journal entries, and bounded retention notes. |
| Customer evidence body | Local copies may be removed when the customer/operator retention boundary says they are disposable. | Metadata-only references, classification, revocation or supersession state, decision boundary, and a note that raw customer material is not embedded. |

Fail closed when the boundary is unclear. Do not remove a branch, worktree,
draft PR reference, patch artifact, local evidence copy, or journal entry when it
is the only durable explanation of the lane attempt.

## Revoked and Superseded Evidence

Use Protocol `v0.4.0` Track B vocabulary for customer lane evidence state:

- `revoked`: a previously recorded approval, draft intent, or evidence reference
  was withdrawn by the authoritative operator boundary.
- `superseded`: a newer lane attempt, proposal, approval record, or evidence
  reference replaces this record for future handling.

Revoked and superseded evidence records are append-only facts. Do not edit older
events or evidence references to make them look as if the approval, proposal, or
attempt never existed.

Customer-confidential and regulated evidence remains metadata-only in public
artifacts. Retain bounded reference metadata such as `approvalState`,
`artifactIntent`, `externalApplicationState`, `supersedesRef`,
`decisionBoundary`, `dataClassification`, and `embedsEvidencePayload: false`.
Do not embed raw customer records, private repository details, secrets,
credentials, workstation-local absolute paths, or local evidence bodies.

## Retry

Use retry when the lane remains valid and the failure is repairable.

1. Keep the worktree, branch, draft PR if present, lane state, issue journal, and
   evidence references.
2. Record the failed or blocked signature before restarting.
3. Repair the explicit prerequisite only.
4. Re-run only a documented Ensen-loop CLI boundary for the retained request.
   For the current bounded local lane smoke path:

```sh
node dist/src/cli/index.js x-gate3-smoke <run-request-json-file> --workspace-root <workspace-root> --state-root <state-root>
```

Retry does not revoke the earlier evidence by itself. If a newer attempt
replaces the older one, record the older evidence as `superseded`.

## Abandon

Use abandon when no retry or repair is intended.

1. Record the abandon decision, issue id, lane id, branch, worktree, draft PR
   reference, and evidence references.
2. Retain evidence explaining the attempted customer lane and why it ended.
3. Remove only disposable local artifacts after confirming they are not
   referenced.
4. Leave remote branches and draft PRs untouched unless the operator explicitly
   confirms the remote cleanup action.

Abandon may pair with `revoked` evidence when a prior approval or draft intent
must no longer be used.

## Manual Repair

Use manual repair when a human will inspect or edit the lane.

1. Keep the worktree, branch, draft PR, lane state, journal, local artifacts, and
   evidence references.
2. Mark the lane as manual repair in the journal or handoff.
3. Record the last known failing command and failure signature.
4. Do not retry or delete artifacts until the repair owner records the next
   decision.

Manual repair can create replacement artifacts. If replacement evidence becomes
authoritative, mark the older evidence as `superseded` rather than deleting its
audit trail.

## Revoke

Use revoke when a previously retained approval, draft intent, or evidence
reference must be withdrawn.

1. Identify the exact approval or evidence reference from the authoritative lane
   record.
2. Record `approvalState: revoked`, `artifactIntent: revocation-record`, and the
   operator decision boundary in retained metadata.
3. Keep the original reference and the revocation record linked.
4. Remove only disposable local artifact copies after retention is confirmed.

Revocation blocks future reliance on the older evidence. It does not erase the
fact that the older evidence existed.

## Supersede

Use supersede when a newer customer lane attempt or evidence reference replaces
an older record.

1. Identify the older and newer evidence references from authoritative records.
2. Record `approvalState: superseded`, `artifactIntent: supersession-record`, and
   `supersedesRef: <previous-evidence-ref>` in bounded metadata.
3. Keep both references reviewable so operators can see the lineage.
4. Delete only local artifact copies that are not needed for the retained audit
   trail.

Supersession changes which evidence should be used going forward. It does not
make the previous evidence disappear.

## Local Command Checklist

Inspect before cleanup:

```sh
node dist/src/cli/index.js run-request <run-request-json-file>
git worktree list --porcelain
git -C <customer-lane-worktree-path> status --short --branch
git branch --list <customer-lane-branch>
```

Remove only confirmed local artifacts:

```sh
git worktree remove <customer-lane-worktree-path>
rm <local-artifact-path>
```

Delete a local branch only through one of these guarded paths:

```sh
git branch --merged HEAD --list <customer-lane-branch>
git branch -d <customer-lane-branch>
```

Use the merged branch path only when the branch is fully merged into the
retained successor or current `HEAD`. For an intentionally abandoned, revoked,
or superseded branch that remains unmerged, first record the retained commit or
patch reference and the explicit operator confirmation, then use:

```sh
git branch -D <customer-lane-branch>
```

Record the final decision:

```text
Outcome: retry | abandon | manual repair | revoke | supersede
Retained evidence: <evidence-ref>, <journal-ref>, <lane-state-ref>
Deleted local artifacts: <worktree-ref>, <branch-ref>, <local-artifact-ref>
Draft PR cleanup: <none-or-draft-pr-ref>
Operator confirmation: <confirmation-ref>
Customer retention boundary: <operator-controlled-retention-ref>
```

Do not use broad recursive deletion commands against repository roots,
supervisor roots, customer workspace roots, shared state roots, or paths whose
ownership is not confirmed by the authoritative lane record.
