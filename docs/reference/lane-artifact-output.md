# Lane Artifact Output

Phase 4 lane artifact output is a review surface for completed local lane runs.
It can describe a patch artifact reference or a PR draft intent, but it does not
create pull requests, merge branches, declare production readiness, or replace
human review.

## Artifact Boundary

Artifact metadata is tied to the authoritative Lane Run state, Work Item,
branch facts, repo-relative worktree facts, AgentProvider outcome,
verification-intent commands, provider capability evidence, and evidence
references. A lane run must be completed before artifact output is emitted.
Status snapshots, provider prose, retries, timeout summaries, or operator text
must not be used to synthesize a terminal artifact.

For execute-capable dogfood lanes, AgentProvider metadata carries the
dry-run-first precondition summary: dry-run proof required, proof provided,
human operator approval provided, merge unsupported, and merge authority
human-only. This metadata explains the approval boundary for reviewers; it does
not grant merge authority.

Artifact paths are public review metadata. They must stay repo-relative under
`artifacts/`, avoid traversal, and avoid raw secrets or workstation-local
absolute paths. Public artifact output must not embed raw evidence bodies,
customer data, repository mutation payloads, credentials, or local machine
paths.

## Protocol v0.2.0 Evidence Boundary

Protocol `v0.2.0` capability evidence keeps terminal result facts separate from
EvidenceBundleRef-compatible metadata. Lane artifact output may reference
evidence with sanitized bundle identifiers and safe URIs, but it must not embed
the evidence payload itself.

`fetchEvidence` support is explicit. `partial` support is reported as partial,
and `unsupported` evidence retrieval fails closed for artifact references instead
of inventing retrievable evidence.

## PR Draft Intent

PR draft intent is only an intent artifact. It requires owner-controlled
repository facts and change-request intent support. The artifact records a draft
review boundary and keeps these fields false:

- pull request creation
- merge readiness
- automatic merge authority

The merge decision remains human-only.
