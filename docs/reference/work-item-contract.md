# Local Work Item Contract

Phase 1 accepts local Work Item JSON as the input shape for dry-run planning. The contract is intentionally small and does not start lane execution, invoke providers, or require a protocol runtime.

The schema is tracked in `schemas/local-work-item.schema.json`.

## Required Fields

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | Stable identifier matching letters, numbers, dots, underscores, or hyphens. |
| `title` | string | Non-empty operator-facing title. |
| `source` | string | Non-empty local source label. |
| `status` | string | One of `ready`, `blocked`, `running`, `completed`, or `failed`. |

Malformed inputs fail closed through `validateLocalWorkItem` or `parseLocalWorkItem` with field-specific issues. Unknown fields are rejected until a later contract version explicitly owns them.

## Deferred Protocol Boundary

This local contract is not an EIP RunRequest. EIP request and result support remains deferred to Phase 2, where the protocol schema, authorization boundary, provenance checks, and adapter mapping rules can be defined explicitly.
