# codex-supervisor Bridge

This directory is a migration bridge for codex-supervisor concepts that still need a named landing place while Ensen-loop defines its own contracts.

It is not the long-term core vocabulary for Ensen-loop. New runtime code should prefer Ensen-loop terms such as lane workspace, lane journal, issue readiness, verification gate, evidence bundle, review repair, and lane introspection.

## Boundary

- Documentation here may explain how predecessor terms map into Ensen-loop terms.
- Implementation code from codex-supervisor should not be copied into this bridge by default.
- Runtime behavior must stay buildable and testable from this repository alone.
- Any future adapter must be optional, explicit, and covered by repo-owned verification.

## Deferred Work

EIP RunRequest and RunResult contracts are intentionally deferred. If a later phase needs them, define the protocol, enforcement boundary, and verification plan before adding bridge code.
