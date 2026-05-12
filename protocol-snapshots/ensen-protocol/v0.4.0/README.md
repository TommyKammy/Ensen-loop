# Ensen-protocol v0.4.0 Track B Evidence Boundary Snapshot

This directory is a copied Track B guidance snapshot from `TommyKammy/Ensen-protocol` release tag `v0.4.0`, protocol version `0.4.0`.

The copied source is Ensen-protocol release commit `f6c3c5bee2574c8660f6954fe58a9e7625daad12`; the annotated tag object is `3e3eddbd0ca654644f7e2676361ff60a80bb972a`.

It is intentionally repo-owned by Ensen-loop. Ensen-loop must not require an Ensen-protocol checkout, package, service, fixture path, or runtime dependency to build, test, or operate.

## Contents

- `docs/integration/customer-regulated-data-classification-profile.md`, copied Track B classification guidance for customer / regulated evidence planning.
- `docs/integration/approval-and-draft-evidence-semantics.md`, copied Track B approval and draft-only evidence guidance.
- `fixtures/customer-regulated-data-classification/v1/valid/public-safe-profile.json`, a public fixture-safe Track B classification example.
- `fixtures/approval-evidence-semantics/v1/valid/public-safe-draft-action.json`, a public fixture-safe draft action example.
- `schemas/eip.common.v1.schema.json`, copied schema evidence for the v0.4.0 `DataClassification` vocabulary.

The copied material is local conformance evidence for protocol intake. It is not production regulated workflow support, ERPNext integration, customer repository execution, electronic signature handling, batch release, final disposition, runtime storage, or a compliance guarantee.

Treat this directory as read-only protocol guidance and fixture-like data. Runtime code should access it only through explicit test or protocol helper boundaries.

To update the snapshot, replace this versioned directory from a tagged Ensen-protocol release and update `manifest.json` in the same change. Do not point tests or runtime code at a sibling checkout as a mutable shared dependency.
