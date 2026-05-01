# X-Gate 3 Local Lane Smoke

This runbook exercises the bounded Phase 3 fake lane path from an EIP
RunRequest fixture through local workspace preparation, deterministic fake
executor invocation, LaneRunState persistence, local evidence metadata, and
RunStatusSnapshot / RunResult projection.

It is a local development smoke boundary. It does not create or mutate GitHub
issues, branches, pull requests, reviews, commits, real agent-provider sessions,
or production evidence archives.

## Invocation

Build the CLI first:

```sh
npm run build
```

Run a succeeded local smoke:

```sh
node dist/src/cli/index.js x-gate3-smoke <run-request-json-file> \
  --workspace-root <workspace-root> \
  --state-root <state-root>
```

Run failure-routing variants:

```sh
node dist/src/cli/index.js x-gate3-smoke <run-request-json-file> \
  --workspace-root <workspace-root> \
  --state-root <state-root> \
  --fixture failed

node dist/src/cli/index.js x-gate3-smoke <run-request-json-file> \
  --workspace-root <workspace-root> \
  --state-root <state-root> \
  --fixture blocked
```

`<workspace-root>` and `<state-root>` must already exist, must be absolute local
paths, must be separate directories, and must not be symbolic links. Public
examples should keep those values as placeholders or documented environment
variables.

## Output

The command writes one parseable JSON aggregate to stdout. Diagnostics and local
execution details are represented either by the aggregate status/result fields
or by local evidence metadata under the state root.

The aggregate uses:

- `schemaVersion: ensen-loop.x-gate3-local-lane-smoke.v1`
- `boundary: local-cli-bounded-fake-lane`
- `mutatesRepository: false`
- `invokesProvider: false`
- `startsAgentProviderSession: false`
- `writesProductionEvidenceArchive: false`
- `statusSnapshot`: EIP RunStatusSnapshot v1 projection from persisted local
  LaneRunState
- `runResult`: EIP RunResult v1 projection from persisted local LaneRunState
- `localArtifacts`: repo-portable paths relative to `<state-root>`

Expected local state artifacts:

```text
<state-root>/lane-runs/<lane-run-id>.json
<state-root>/lane-runs/<lane-run-id>/artifacts/evidence/local-lane/<lane-run-id>.json
```

The evidence metadata is local-development metadata. It records bounded facts
such as lane identifiers, fake executor outcome, verification summary, blocked
reasons, and a safe EvidenceBundleRef. It must not be treated as a production
evidence archive or compliance bundle.

## Failure Routing

Invalid RunRequest input and unsupported EIP major versions fail closed. When
stable request and correlation identifiers are available, the command emits a
blocked RunStatusSnapshot and blocked RunResult. If those identifiers are not
available, it emits a validation failure object.

Unsafe local roots fail before lane state or evidence metadata is written. This
includes missing roots, relative roots, shared workspace/state roots, symlinked
roots, malformed lane identifiers, and symlink-mediated lane paths.

Fake executor outcomes are explicit:

- `--fixture succeeded` exits `0` and projects a succeeded RunResult.
- `--fixture failed` exits `1` and projects a failed RunResult.
- `--fixture blocked` exits `1` and projects blocked status/result surfaces.

## Cleanup

The command only writes under the supplied local roots. Remove the local smoke
roots after inspection:

```sh
rm -rf <workspace-root> <state-root>
```

Do not point cleanup commands at a repository root, a shared supervisor root, or
any path that is not dedicated to the local smoke run.

## Flow Boundary

Flow Phase 3 callers should treat this command as a process boundary:

```sh
node dist/src/cli/index.js x-gate3-smoke <run-request-json-file> \
  --workspace-root <workspace-root> \
  --state-root <state-root>
```

Callers should parse stdout JSON and should not import Ensen-loop TypeScript
implementation code. Any future integration should pass protocol-shaped input
and consume protocol-shaped status/result output across an explicit boundary.
