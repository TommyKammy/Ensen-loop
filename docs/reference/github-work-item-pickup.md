# GitHub WorkItem Pickup

GitHub issue pickup is an SCMProvider adapter boundary for `work-item-pickup`.
It normalizes already-loaded GitHub issue facts into provider-neutral Work Item
facts and sanitized scope/provenance facts. It is pre-executor input
collection only.

The pickup boundary is read-only. It must not edit issues, labels, branches,
comments, pull requests, commits, checks, or any other GitHub state. It also
must not start a Codex session or advertise executor capabilities such as
`submit`, `status`, `cancel`, or `fetchEvidence`.

Repositories are blocked unless an operator-owned allowlist explicitly marks
the exact repository as owner-controlled:

```json
{
  "allowlist": [
    {
      "owner": "TommyKammy",
      "name": "Ensen-loop",
      "ownerControlled": true
    }
  ],
  "issue": {
    "repository": {
      "owner": "TommyKammy",
      "name": "Ensen-loop",
      "htmlUrl": "https://github.com/TommyKammy/Ensen-loop"
    },
    "issue": {
      "number": 56,
      "title": "LOOP-031: Add GitHub WorkItem pickup for owner-controlled repos",
      "state": "open",
      "htmlUrl": "https://github.com/TommyKammy/Ensen-loop/issues/56"
    },
    "requester": {
      "login": "owner-maintainer"
    }
  }
}
```

Successful pickup returns a Work Item with `source: "github-issue"` plus
sanitized scope facts: provider, repository, issue number, issue URL,
repository URL, requester login, and `ownerControlled: true`. These facts are
authoritative input for later lane submission and idempotency binding, but they
do not mean execution has started.

Malformed issue references, missing requester provenance, missing repository
URL facts, secret-like input fields, and repositories that are not explicitly
allowlisted as owner-controlled fail closed with field-specific diagnostics.
GitHub-authored issue text remains untrusted context and does not grant
operator permission by itself.

Protocol `v0.2.0` remains copied/vendored contract evidence only. GitHub pickup
does not import Ensen-protocol runtime code and does not implement protocol
`submit`, `status`, `cancel`, or `fetchEvidence`.
