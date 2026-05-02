# Ensen-protocol v0.2.0 Snapshot

This directory is a copied snapshot of public Ensen Interop Protocol artifacts from `TommyKammy/Ensen-protocol` release tag `v0.2.0`, protocol version `0.2.0`, with the local corrections listed in `manifest.json`.

It is intentionally repo-owned by Ensen-loop. Ensen-loop must not require an Ensen-protocol checkout, package, service, fixture path, or runtime dependency to build, test, or operate.

Protocol release `v0.2.0` does not mean the EIP artifact schemas are `v2`. The copied RunRequest, RunStatusSnapshot, RunResult, and EvidenceBundleRef artifacts still use `eip.*.v1` schema versions until a future protocol release explicitly defines new schema majors.

## Contents

- `schemas/eip.run-request.v1.schema.json`
- `schemas/eip.run-status.v1.schema.json`
- `schemas/eip.run-result.v1.schema.json`
- `schemas/eip.evidence-bundle-ref.v1.schema.json`
- `schemas/eip.common.v1.schema.json`, copied as schema support for `$ref` resolution
- valid and invalid public conformance fixtures for RunRequest, RunStatusSnapshot, RunResult, and EvidenceBundleRef
- public-safe `fixtures/capability-variants/v1/valid/` examples for Phase 4 provider boundary checks

## Update Policy

Treat this directory as read-only protocol fixture data. Runtime code should access it only through explicit test or protocol helper boundaries.

To update the snapshot, replace this versioned directory from a tagged Ensen-protocol release and update `manifest.json` in the same change. Do not point tests or runtime code at a sibling checkout as a mutable shared dependency.

If the next tagged Ensen-protocol release already includes the local corrections recorded in `manifest.json`, remove those correction entries during the replacement.
