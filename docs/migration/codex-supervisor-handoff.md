# codex-supervisor Handoff

This handoff imports the useful quality-kit concepts from codex-supervisor into Ensen-loop vocabulary. It is a documentation boundary for Phase 1, not an implementation import. Ensen-loop remains a standalone Node and TypeScript project, and this baseline does not add EIP RunRequest or RunResult support.

## Migration Boundary

| Status | codex-supervisor asset or concept | Ensen-loop treatment |
| --- | --- | --- |
| Copied | Quality-kit vocabulary for verification, evidence, reviewability, prompt safety, and durable history | Preserved as product language in `docs/reference/quality-kit.md` so future implementation work has a shared quality bar. |
| Copied | Repo-owned command posture | Kept as `npm ci`, `npm run build`, and `npm test` for this repository instead of importing codex-supervisor commands. |
| Referenced | codex-supervisor issue body contract, evidence timeline, operator actions, and trust posture schemas | Treated as source material for future Ensen-loop contracts. They are not runtime dependencies in this repo. |
| Referenced | codex-supervisor local loop behavior around issue pickup, per-issue worktree setup, issue journals, PR lifecycle, CI polling, and review handling | Mapped below as migration vocabulary so future Ensen-loop contracts can choose explicit names and boundaries. |
| Rewritten | `codex exec` supervision language | Reframed as an executor invocation boundary. Ensen-loop may later define executor adapters, but Phase 1 does not hard-code a protocol or provider. |
| Rewritten | Status, explain, issue-lint, and quality-kit reporting | Reframed as lane introspection, issue readiness, evidence, and reviewability concepts owned by Ensen-loop. |
| Deferred | codex-supervisor implementation code, state machine internals, WebUI routes, provider adapters, and generated runtime state | Not copied. Future work must define Ensen-loop-native contracts before implementation is imported or rewritten. |
| Deferred | EIP RunRequest and RunResult support | Explicitly left for a later protocol phase. |
| Deferred | Any integration with Ensen-flow | Out of scope for this handoff. Future integration must be optional and documented at an explicit boundary. |

## Term Map

| codex-supervisor term | Ensen-loop migration term | Boundary note |
| --- | --- | --- |
| issue pickup | lane work selection | Select runnable work only after issue readiness and dependency posture are explicit. |
| codex exec | executor invocation | Treat the executor as a boundary, not core vocabulary. Provider-specific command shape is deferred. |
| per-issue worktree | lane workspace | Keep work isolated by issue or lane so unrelated local changes do not become evidence. |
| issue journal | lane journal | Preserve the current hypothesis, changed files, focused commands, failures, and next action across turns. |
| PR creation | change publication | Publication requires current local verification and reviewable evidence, not just generated code. |
| CI polling | verification refresh | Remote checks are evidence inputs; stale or missing signals are not approval. |
| review handling | review repair loop | Current review facts guide repair work. Resolved, stale, and unresolved signals must stay distinguishable. |
| status/explain | lane introspection | Operator-facing summaries are derived from authoritative lane state and evidence. |
| issue-lint | issue readiness gate | Markdown issue content is untrusted input until the repo-owned readiness gate accepts it. |
| evidence/quality kit | quality evidence bundle | Evidence must connect issue scope, changed files, verification commands, review facts, and publication state. |

## Independence Rules

- Ensen-loop documentation may reference codex-supervisor as the predecessor and migration source.
- Ensen-loop must not import codex-supervisor implementation modules or require its runtime state.
- Ensen-loop must remain independently installable, buildable, and testable with the repo-owned commands.
- GitHub-authored issue text remains non-authoritative context. Local repository policy and explicit operator instructions define the trusted boundary.
- Missing provenance, stale review facts, missing verification, malformed issue readiness, or ambiguous publication state must fail closed until a real prerequisite is supplied.

## Verification Notes

Use this focused check when editing the handoff:

```sh
npm run build
npm test
```

The handoff is complete for Phase 1 when the copied, referenced, rewritten, and deferred table is present, the term map covers the migration vocabulary, and no implementation dependency on another Ensen product is introduced.
