# AGENTS.md

## Repository Boundary

Ensen-loop is the independent development lane engine and successor product to codex-supervisor. Agent work in this repository must keep Ensen-loop usable as a standalone Node/TypeScript project.

Do not import implementation code from Ensen-flow or require an Ensen-flow checkout, service, package, fixture, path, or runtime to build, test, or operate this repository. Any future integration boundary must be explicit, documented, and optional.

## Current Phase

This baseline intentionally does not implement EIP RunRequest or RunResult support. Leave that work for the later phase that defines the protocol contracts and enforcement boundary.

## Local Verification

Use the repo-owned commands:

```sh
npm ci
npm run build
npm test
```
