import assert from "node:assert/strict";
import test from "node:test";

import {
  CODEX_AGENT_PROVIDER_CAPABILITY_EVIDENCE,
  createCodexAgentInvocationIntent,
} from "../src/agent/index.js";
import {
  createLaneArtifactOutput,
  validateLaneArtifactOutput,
} from "../src/artifact/index.js";
import {
  createLaneJournal,
  createLaneRunState,
} from "../src/lane/index.js";
import type { EvidenceBundleRef } from "../src/protocol/index.js";

const completedState = createLaneRunState({
  id: "run_issue60Patch01",
  workItemId: "workitem_issue60Patch01",
  status: "completed",
  revision: 3,
  createdAt: "2026-05-02T00:00:00.000Z",
  updatedAt: "2026-05-02T00:05:00.000Z",
  journal: createLaneJournal({
    id: "journal-issue60Patch01",
    laneRunId: "run_issue60Patch01",
    workItemId: "workitem_issue60Patch01",
    entries: [],
  }),
  evidence: {
    bundleRefs: ["artifacts/evidence/issue-60/bundle-ref.json"],
  },
});

const safeEvidenceRef: EvidenceBundleRef = {
  schemaVersion: "eip.evidence-bundle-ref.v1",
  id: "evb_issue60PatchEvidence01",
  correlationId: "corr_issue60PatchEvidence01",
  type: "local_path",
  uri: "artifacts/evidence/issue-60/bundle-ref.json",
  createdAt: "2026-05-02T00:05:00Z",
  contentType: "application/json",
  metadata: {
    producer: "ensen-loop",
    artifactKind: "phase4ArtifactEvidenceReference",
    embedsEvidencePayload: false,
  },
};

const agentOutcome = createCodexAgentInvocationIntent({
  mode: "execute",
  capabilityEvidence: CODEX_AGENT_PROVIDER_CAPABILITY_EVIDENCE,
  workspace: {
    kind: "repo-relative",
    path: ".",
  },
  allowedExecutionPosture: "execute-enabled",
  scope: {
    owner: "TommyKammy",
    repository: "Ensen-loop",
    issueNumber: 60,
  },
  idempotencyBinding: {
    key: "issue-60-codex-submit",
    scopeFingerprint: "TommyKammy-Ensen-loop-60",
  },
});

test("emits patch artifact metadata tied to completed lane state without raw evidence", () => {
  const artifact = createLaneArtifactOutput({
    kind: "patch",
    laneRunState: completedState,
    workItem: {
      id: "workitem_issue60Patch01",
      title: "LOOP-035: Add patch or PR draft artifact output",
      source: "github-issue-60",
      status: "completed",
    },
    branch: {
      name: "codex/issue-60",
      base: "main",
    },
    worktree: {
      kind: "repo-relative",
      path: ".",
    },
    artifactRef: {
      uri: "artifacts/patches/issue-60.patch",
      mediaType: "text/x-diff",
    },
    agentOutcome,
    verificationIntent: {
      commands: ["npm run typecheck", "npm run build", "npm test"],
    },
    capabilityEvidence: CODEX_AGENT_PROVIDER_CAPABILITY_EVIDENCE,
    evidenceRefs: [safeEvidenceRef],
  });

  assert.equal(validateLaneArtifactOutput(artifact).ok, true);
  assert.equal(artifact.kind, "patch");
  assert.equal(artifact.laneRun.id, completedState.id);
  assert.equal(artifact.workItem.id, completedState.workItemId);
  assert.equal(artifact.humanReview.required, true);
  assert.equal(artifact.humanReview.mergeAuthority, "human-only");
  assert.equal(artifact.createsPullRequest, false);
  assert.equal(artifact.mergeReady, false);
  assert.deepEqual(artifact.evidence.references, [
    {
      evidenceBundleId: safeEvidenceRef.id,
      uri: safeEvidenceRef.uri,
      fetchEvidence: "partial",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(artifact), /rawEvidence|customer data|token=/i);
});

test("emits guarded PR draft intent without implying automatic merge authority", () => {
  const artifact = createLaneArtifactOutput({
    kind: "pr-draft-intent",
    laneRunState: completedState,
    workItem: {
      id: "workitem_issue60Patch01",
      title: "LOOP-035: Add patch or PR draft artifact output",
      source: "github-issue-60",
      status: "completed",
    },
    branch: {
      name: "codex/issue-60",
      base: "main",
    },
    worktree: {
      kind: "repo-relative",
      path: ".",
    },
    artifactRef: {
      uri: "artifacts/pr-drafts/issue-60.json",
      mediaType: "application/json",
    },
    agentOutcome,
    verificationIntent: {
      commands: ["npm run typecheck"],
    },
    capabilityEvidence: CODEX_AGENT_PROVIDER_CAPABILITY_EVIDENCE,
    ownerControlledRepository: {
      provider: "github",
      repositorySlug: "TommyKammy/Ensen-loop",
      changeRequestIntentSupported: true,
    },
    evidenceRefs: [safeEvidenceRef],
  });

  assert.equal(artifact.kind, "pr-draft-intent");
  assert.equal(artifact.createsPullRequest, false);
  assert.equal(artifact.changeRequestIntent.status, "draft");
  assert.equal(artifact.changeRequestIntent.humanReviewBoundary, true);
  assert.equal(artifact.mergeReady, false);
  assert.equal(artifact.autoMerge, false);
});

test("fails closed for unsafe paths, unsupported evidence fetch, and unsupported PR draft scope", () => {
  assert.throws(
    () =>
      createLaneArtifactOutput({
        kind: "patch",
        laneRunState: completedState,
        workItem: {
          id: "workitem_issue60Patch01",
          title: "LOOP-035: Add patch or PR draft artifact output",
          source: "github-issue-60",
          status: "completed",
        },
        branch: {
          name: "codex/issue-60",
          base: "main",
        },
        worktree: {
          kind: "repo-relative",
          path: ".",
        },
        artifactRef: {
          uri: "/Users/example/secret.patch",
          mediaType: "text/x-diff",
        },
        agentOutcome,
        verificationIntent: {
          commands: ["npm test"],
        },
        capabilityEvidence: CODEX_AGENT_PROVIDER_CAPABILITY_EVIDENCE,
      }),
    /artifact path must be repo-relative/i,
  );

  assert.throws(
    () =>
      createLaneArtifactOutput({
        kind: "patch",
        laneRunState: completedState,
        workItem: {
          id: "workitem_issue60Patch01",
          title: "LOOP-035: Add patch or PR draft artifact output",
          source: "github-issue-60",
          status: "completed",
        },
        branch: {
          name: "codex/issue-60",
          base: "main",
        },
        worktree: {
          kind: "repo-relative",
          path: ".",
        },
        artifactRef: {
          uri: "artifacts/patches/issue-60.patch",
          mediaType: "text/x-diff",
        },
        agentOutcome,
        verificationIntent: {
          commands: ["npm test"],
        },
        capabilityEvidence: {
          ...CODEX_AGENT_PROVIDER_CAPABILITY_EVIDENCE,
          operations: {
            ...CODEX_AGENT_PROVIDER_CAPABILITY_EVIDENCE.operations,
            fetchEvidence: "unsupported",
          },
        },
        evidenceRefs: [safeEvidenceRef],
      }),
    /fetchEvidence is unsupported/i,
  );

  assert.throws(
    () =>
      createLaneArtifactOutput({
        kind: "pr-draft-intent",
        laneRunState: completedState,
        workItem: {
          id: "workitem_issue60Patch01",
          title: "LOOP-035: Add patch or PR draft artifact output",
          source: "github-issue-60",
          status: "completed",
        },
        branch: {
          name: "codex/issue-60",
          base: "main",
        },
        worktree: {
          kind: "repo-relative",
          path: ".",
        },
        artifactRef: {
          uri: "artifacts/pr-drafts/issue-60.json",
          mediaType: "application/json",
        },
        agentOutcome,
        verificationIntent: {
          commands: ["npm test"],
        },
        capabilityEvidence: CODEX_AGENT_PROVIDER_CAPABILITY_EVIDENCE,
        ownerControlledRepository: {
          provider: "github",
          repositorySlug: "TommyKammy/Ensen-loop",
          changeRequestIntentSupported: false,
        },
      }),
    /owner-controlled repository with change-request intent support/i,
  );
});

test("refuses artifact output before an authoritative terminal lane state exists", () => {
  assert.throws(
    () =>
      createLaneArtifactOutput({
        kind: "patch",
        laneRunState: {
          ...completedState,
          status: "running",
        },
        workItem: {
          id: "workitem_issue60Patch01",
          title: "LOOP-035: Add patch or PR draft artifact output",
          source: "github-issue-60",
          status: "running",
        },
        branch: {
          name: "codex/issue-60",
          base: "main",
        },
        worktree: {
          kind: "repo-relative",
          path: ".",
        },
        artifactRef: {
          uri: "artifacts/patches/issue-60.patch",
          mediaType: "text/x-diff",
        },
        agentOutcome,
        verificationIntent: {
          commands: ["npm test"],
        },
        capabilityEvidence: CODEX_AGENT_PROVIDER_CAPABILITY_EVIDENCE,
      }),
    /completed lane state/i,
  );
});
