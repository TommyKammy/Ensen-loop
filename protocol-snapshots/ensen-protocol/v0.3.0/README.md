# Ensen-protocol v0.3.0 Operational Evidence Profile Snapshot

This directory is a copied Track A guidance snapshot from `TommyKammy/Ensen-protocol` release tag `v0.3.0`, protocol version `0.3.0`.

The copied source is PROTOCOL-040 from Ensen-protocol issue #50 / PR #51, merged as commit `c33277e5a470883493f10f2c6951a0ca0d5818b0`.

It is intentionally repo-owned by Ensen-loop. Ensen-loop must not require an Ensen-protocol checkout, package, service, fixture path, or runtime dependency to build, test, or operate.

## Contents

- `docs/integration/operational-evidence-profile.md`, copied contract guidance for X-Gate 3 Track A artifact hygiene.
- `fixtures/operational-evidence-profile/v1/valid/public-fixture-safe-profile.json`, a public fixture-safe profile example.

The copied material is local conformance evidence for owner-controlled repo / solo dogfood hygiene. It is not runtime integration, artifact storage, cleanup, recovery, a credential service, a retention system, or a compliance guarantee.

## Update Policy

Treat this directory as read-only protocol guidance and fixture-like data. Runtime code should access it only through explicit test or protocol helper boundaries.

To update the snapshot, replace this versioned directory from a tagged Ensen-protocol release and update `manifest.json` in the same change. Do not point tests or runtime code at a sibling checkout as a mutable shared dependency.
