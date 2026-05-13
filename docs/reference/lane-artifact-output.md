# Lane Artifact Output

Phase 4 lane artifact output is a review surface for completed local lane runs.
It can describe a patch artifact reference or a PR draft intent, but it does not
create pull requests, merge branches, declare production readiness, or replace
human review. It never records an automatic final quality decision.

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

Artifact output records merge authority and final quality decision authority as
human-only control points. `mergeReady`, `autoMerge`, and
`automaticQualityDecision` must remain false.

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

## Protocol v0.4.0 Track B Classification

Protocol `v0.4.0` adds the Track B customer / regulated evidence classification
profile. Ensen-loop consumes that copied snapshot as local conformance guidance,
not as a runtime dependency on Ensen-protocol and not as a compliance claim.

Track A operational evidence remains the public fixture-safe owner-controlled
evidence profile. Track B customer lane evidence is a separate boundary. When an
EvidenceBundleRef explicitly marks Track B customer lane or controlled evidence,
public artifact export and RunResult projection require an explicit
`dataClassification` value from the Loop-supported Track B set:

- `public`
- `internal`
- `customer-confidential`
- `regulated`

Missing, unknown, legacy, or inferred classification fails closed before public
artifact export or RunResult evidence projection. Classification must come from
bounded reference metadata; Ensen-loop must not infer it from URI shape,
repository names, issue text, comments, or nearby operator summaries.

Customer-confidential and regulated references remain references only. They may
carry safe metadata such as producer, protocol version, validation command,
reference kind, checksum status, and explicit classification. Controlled
metadata values must come from bounded protocol vocabulary or bounded validation
command forms; free-form customer text is not safe reference metadata. They must
not embed raw customer files, raw records, credentials, secrets, private
repository details, or workstation-local absolute paths in public artifacts.

## PR Draft Intent

PR draft intent is only an intent artifact. It requires owner-controlled
repository facts and change-request intent support. The artifact records a draft
review boundary and keeps these fields false:

- pull request creation
- merge readiness
- automatic merge authority
- automatic final quality decision

The merge decision and final quality decision remain human-only. Track B
customer lane evidence can be exported only as patch artifact metadata; it cannot
activate PR draft intent, automatic merge, or automatic quality-decision paths.
This does not permit production use, live ERPNext write-back, regulated workflow
execution, or compliance guarantees.
