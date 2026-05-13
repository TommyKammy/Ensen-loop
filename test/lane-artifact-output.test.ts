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

const completedStateWithoutEvidence = createLaneRunState({
  id: "run_issue60PatchNoEvidence01",
  workItemId: "workitem_issue60Patch01",
  status: "completed",
  revision: 4,
  createdAt: "2026-05-02T00:00:00.000Z",
  updatedAt: "2026-05-02T00:06:00.000Z",
  journal: createLaneJournal({
    id: "journal-issue60PatchNoEvidence01",
    laneRunId: "run_issue60PatchNoEvidence01",
    workItemId: "workitem_issue60Patch01",
    entries: [],
  }),
  evidence: {
    bundleRefs: [],
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

const customerLaneEvidenceRef: EvidenceBundleRef = {
  ...safeEvidenceRef,
  id: "evb_issue98TrackBEvidence01",
  correlationId: "corr_issue98TrackBEvidence01",
  metadata: {
    producer: "ensen-loop",
    evidenceTrack: "track-b",
    evidenceBoundary: "customer-lane",
    dataClassification: "customer-confidential",
    referenceKind: "controlledEvidenceReference",
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
  dryRunProof: {
    mode: "dry-run",
    outcome: "planned",
    requestId: "req_issue60DryRunProof01",
    correlationId: "corr_issue60DryRunProof01",
    completedAt: "2026-05-02T00:04:00.000Z",
    scope: {
      owner: "TommyKammy",
      repository: "Ensen-loop",
      issueNumber: 60,
    },
    idempotencyBinding: {
      key: "issue-60-codex-submit",
      scopeFingerprint: "TommyKammy-Ensen-loop-60",
    },
  },
  operatorApproval: {
    actorType: "human",
    decision: "execute-after-dry-run",
    approvedAt: "2026-05-02T00:05:00.000Z",
  },
});

type CreateArtifactInput = Parameters<typeof createLaneArtifactOutput>[0];

function createSafePatchInput(overrides: Partial<CreateArtifactInput> = {}): CreateArtifactInput {
  return {
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
    capabilityEvidence: CODEX_AGENT_PROVIDER_CAPABILITY_EVIDENCE,
    evidenceRefs: [safeEvidenceRef],
    ...overrides,
  };
}

const posixRootPath = (...segments: readonly string[]): string => ["", ...segments].join("/");
const windowsDrivePath = (...segments: readonly string[]): string => ["C:", ...segments].join("\\");
const windowsUncPath = (...segments: readonly string[]): string => ["", "", ...segments].join("\\");
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
  assert.deepEqual(artifact.agentProvider.executionPreconditions, {
    dryRunRequired: true,
    dryRunProof: "provided",
    operatorApproval: "provided",
    mergeSupported: false,
    mergeAuthority: "human-only",
  });
  assert.deepEqual(artifact.evidence.references, [
    {
      evidenceBundleId: safeEvidenceRef.id,
      uri: safeEvidenceRef.uri,
      fetchEvidence: "partial",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(artifact), /rawEvidence|customer data|token=/i);
});

test("requires explicit Track B customer lane evidence classification before public artifact export", () => {
  assert.doesNotThrow(() =>
    createLaneArtifactOutput(
      createSafePatchInput({
        evidenceRefs: [customerLaneEvidenceRef],
      }),
    ),
  );

  const missingClassificationMetadata = { ...customerLaneEvidenceRef.metadata };
  delete missingClassificationMetadata.dataClassification;
  const invalidMetadataCases = [
    missingClassificationMetadata,
    {
      ...customerLaneEvidenceRef.metadata,
      dataClassification: "unknown",
    },
    {
      ...customerLaneEvidenceRef.metadata,
      dataClassification: "confidential",
    },
  ];

  for (const metadata of invalidMetadataCases) {
    assert.throws(
      () =>
        createLaneArtifactOutput(
          createSafePatchInput({
            evidenceRefs: [
              {
                ...customerLaneEvidenceRef,
                metadata,
              },
            ],
          }),
        ),
      /Track B customer lane evidence requires an explicit allowed data classification/i,
    );
  }
});

test("keeps Track B confidential evidence references metadata-only in public artifact export", () => {
  assert.throws(
    () =>
      createLaneArtifactOutput(
        createSafePatchInput({
          evidenceRefs: [
            {
              ...customerLaneEvidenceRef,
              metadata: {
                ...customerLaneEvidenceRef.metadata,
                rawCustomerRecord: "synthetic customer order payload",
              },
            },
          ],
        }),
      ),
    /Track B customer lane evidence references must not embed raw controlled material/i,
  );
});

test("rejects generic local absolute paths in public artifact metadata without echoing raw values", () => {
  const unsafePublicPaths = [
    posixRootPath("tmp"),
    posixRootPath("var"),
    posixRootPath("var", "folders", "private-output.log"),
    posixRootPath("tmp", "private-output.log"),
    windowsDrivePath("Temp", "private-output.log"),
    windowsUncPath("build-host", "share", "private-output.log"),
  ];

  for (const unsafePublicPath of unsafePublicPaths) {
    assert.throws(
      () =>
        createLaneArtifactOutput(
          createSafePatchInput({
            workItem: {
              id: "workitem_issue60Patch01",
              title: `LOOP-035: output captured at ${unsafePublicPath}`,
              source: "github-issue-60",
              status: "completed",
            },
          }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /raw secrets or workstation-local absolute paths/i);
        assert.doesNotMatch(error.message, new RegExp(escapeRegExp(unsafePublicPath)));
        return true;
      },
    );
  }
});

test("rejects secret-like public artifact values without echoing raw values", () => {
  const unsafePublicValues = [
    "Authorization: Bearer ghp_1234567890abcdef",
    "set-cookie: sessionid=s3ssion-value; HttpOnly",
    "-----BEGIN OPENSSH PRIVATE KEY-----",
    "apiKey = sk-test-1234567890abcdef",
  ];

  for (const unsafePublicValue of unsafePublicValues) {
    assert.throws(
      () =>
        createLaneArtifactOutput(
          createSafePatchInput({
            workItem: {
              id: "workitem_issue60Patch01",
              title: `LOOP-035: ${unsafePublicValue}`,
              source: "github-issue-60",
              status: "completed",
            },
          }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /raw secrets or workstation-local absolute paths/i);
        assert.doesNotMatch(error.message, new RegExp(escapeRegExp(unsafePublicValue)));
        return true;
      },
    );
  }
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
  assert.equal(artifact.agentProvider.executionPreconditions.mergeSupported, false);
  assert.equal(artifact.agentProvider.executionPreconditions.mergeAuthority, "human-only");
});

test("emits explicit unsupported fetchEvidence only when no evidence references are present", () => {
  const artifact = createLaneArtifactOutput({
    kind: "patch",
    laneRunState: completedStateWithoutEvidence,
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
  });

  assert.equal(artifact.evidence.fetchEvidence, "unsupported");
  assert.deepEqual(artifact.evidence.references, []);
  assert.equal(validateLaneArtifactOutput(artifact).ok, true);
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
          uri: "/tmp/unsafe.patch",
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

test("validates nested public artifact fields and fails closed on unsafe serialization", () => {
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
      commands: ["npm test"],
    },
    capabilityEvidence: CODEX_AGENT_PROVIDER_CAPABILITY_EVIDENCE,
    evidenceRefs: [safeEvidenceRef],
  });

  const malformedNestedFields = validateLaneArtifactOutput({
    ...artifact,
    branch: {
      name: "../escape",
      base: "main",
    },
    worktree: {
      kind: "repo-relative",
      path: "../escape",
    },
    artifact: {
      uri: "patches/issue-60.patch",
      mediaType: "text/plain",
    },
    verificationIntent: {
      commands: [""],
    },
  });

  assert.equal(malformedNestedFields.ok, false);
  assert.deepEqual(
    malformedNestedFields.ok ? [] : malformedNestedFields.issues.map((issue) => issue.path),
    [
      "branch",
      "worktree",
      "artifact.uri",
      "artifact.mediaType",
      "verificationIntent.commands",
    ],
  );

  const circularArtifact: Record<string, unknown> = { ...artifact };
  circularArtifact.self = circularArtifact;

  const circularValidation = validateLaneArtifactOutput(circularArtifact);

  assert.equal(circularValidation.ok, false);
  assert.match(
    circularValidation.ok ? "" : circularValidation.issues.map((issue) => issue.message).join("\n"),
    /raw secrets or workstation-local absolute paths/i,
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
