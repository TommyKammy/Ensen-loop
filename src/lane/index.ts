import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { LaneAuditRefs } from "../audit/index.js";
import {
  AGENT_PROVIDER_CAPABILITIES,
  SCM_PROVIDER_CAPABILITIES,
  type WorkItem,
} from "../core/index.js";
import type { LaneEvidenceRefs } from "../evidence/index.js";
import type { EvidenceBundleRef } from "../protocol/index.js";
import { sampleLocalWorkItem } from "../work-item/index.js";

export type LaneRunStatus =
  | "queued"
  | "running"
  | "verifying"
  | "reviewing"
  | "blocked"
  | "completed"
  | "failed";

export type LaneJournalEntryKind = "hypothesis" | "command" | "failure" | "change" | "next-action";

export interface LaneJournalEntry {
  readonly id: string;
  readonly recordedAt: string;
  readonly kind: LaneJournalEntryKind;
  readonly message: string;
}

export interface LaneJournal {
  readonly id: string;
  readonly laneRunId: string;
  readonly workItemId: WorkItem["id"];
  readonly entries: readonly LaneJournalEntry[];
}

export interface LaneRunState {
  readonly id: string;
  readonly workItemId: WorkItem["id"];
  readonly status: LaneRunStatus;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startsAgentExecution: false;
  readonly journal: LaneJournal;
  readonly audit: LaneAuditRefs;
  readonly evidence: LaneEvidenceRefs;
}

export interface CreateLaneJournalInput {
  readonly id: string;
  readonly laneRunId: string;
  readonly workItemId: WorkItem["id"];
  readonly entries?: readonly LaneJournalEntry[];
}

export interface CreateLaneRunStateInput {
  readonly id: string;
  readonly workItemId: WorkItem["id"];
  readonly status: LaneRunStatus;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly journal: LaneJournal;
  readonly audit?: LaneAuditRefs;
  readonly evidence?: LaneEvidenceRefs;
}

export interface PrepareLocalLaneWorkspaceInput {
  readonly workspaceRoot: string;
  readonly stateRoot: string;
  readonly laneRunId?: string;
  readonly workItemId?: string;
}

export interface PreparedLocalLaneWorkspace {
  readonly directoryName: string;
  readonly workspacePath: string;
  readonly statePath: string;
  readonly created: {
    readonly workspace: boolean;
    readonly state: boolean;
  };
}

export type BranchLaneRunSkeletonMode = "dry-run" | "prepare";
export type LaneRepositoryClassification = "owner-controlled-dogfood" | "customer-repository";
export type LaneRunQueueStatus = "queued" | "completed" | "revoked" | "superseded";
export type LaneRunLockStatus = "active" | "completed" | "revoked" | "superseded";
const CUSTOMER_REPOSITORY_PLACEHOLDER = "<customer-repository>";

export interface LaneRunQueueDiagnostics {
  readonly stableWorkItemId: string;
  readonly laneId: string;
  readonly source: string;
  readonly repositoryClassification: LaneRepositoryClassification;
  readonly status: LaneRunQueueStatus;
}

export interface LaneRunLockDiagnostics {
  readonly stableWorkItemId: string;
  readonly laneId: string;
  readonly source: string;
  readonly repositoryClassification: LaneRepositoryClassification;
  readonly lockStatus: LaneRunLockStatus;
  readonly laneRunId: string;
  readonly reason: string;
}

interface LaneRunMutationLockOwner {
  readonly schemaVersion: "ensen.lane-run-mutation-lock-owner.v1";
  readonly token: string;
  readonly pid: number;
  readonly acquiredAt: string;
}

export interface LaneRunQueueRecord {
  readonly schemaVersion: "ensen.lane-run-queue.v1";
  readonly id: string;
  readonly stableWorkItemId: string;
  readonly workItemId: WorkItem["id"];
  readonly source: string;
  readonly laneId: string;
  readonly repositoryClassification: LaneRepositoryClassification;
  readonly status: LaneRunQueueStatus;
  readonly queuedAt: string;
  readonly updatedAt: string;
  readonly startsAgentExecution: false;
  readonly metadata: Record<string, string>;
  readonly publicDiagnostics: LaneRunQueueDiagnostics;
}

export interface LaneRunLock {
  readonly schemaVersion: "ensen.lane-run-lock.v1";
  readonly stableWorkItemId: string;
  readonly queueRecordId: string;
  readonly laneRunId: string;
  readonly laneId: string;
  readonly source: string;
  readonly repositoryClassification: LaneRepositoryClassification;
  readonly status: LaneRunLockStatus;
  readonly active: boolean;
  readonly claimedAt: string;
  readonly claimedBy: string;
  readonly releasedAt?: string;
  readonly startsAgentExecution: false;
}

export interface EnqueueLaneRunInput {
  readonly stableWorkItemId: string;
  readonly workItemId: WorkItem["id"];
  readonly source: string;
  readonly laneId: string;
  readonly repositoryClassification: LaneRepositoryClassification;
  readonly queuedAt: string;
  readonly metadata?: Record<string, string>;
}

export interface ClaimQueuedLaneRunInput {
  readonly stableWorkItemId: string;
  readonly laneRunId: string;
  readonly claimedBy: string;
  readonly claimedAt: string;
}

export interface CompleteLaneRunLockInput {
  readonly stableWorkItemId: string;
  readonly laneRunId: string;
  readonly completedAt: string;
  readonly terminalStatus: Exclude<LaneRunLockStatus, "active">;
}

export type ClaimQueuedLaneRunResult =
  | {
      readonly ok: true;
      readonly lock: LaneRunLock;
      readonly publicDiagnostics: LaneRunLockDiagnostics;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly lock: LaneRunLock;
      readonly publicDiagnostics: LaneRunLockDiagnostics;
    };

export interface AuthoritativeLaneRunScope {
  readonly repositoryClassification?: LaneRepositoryClassification;
  readonly ownerControlled?: true;
  readonly ownerIdentity?: string;
  readonly repositoryId: string;
  readonly repositorySlug: string;
  readonly repositoryUrl?: string;
  readonly repositoryRoot: string;
  readonly customerRepositoryPurpose?: string;
  readonly customerApprovalNote?: string;
}

export interface OwnerControlledDogfoodRepositoryAllowlistEntry {
  readonly ownerControlled: true;
  readonly ownerIdentity: string;
  readonly repositorySlug: string;
  readonly repositoryUrl: string;
  readonly repositoryRoot: string;
}

export interface CustomerRepositoryAllowlistEntry {
  readonly repositoryClassification: "customer-repository";
  readonly owner: string;
  readonly repo: string;
  readonly repositoryRoot: string;
  readonly purpose: string;
  readonly approvalNote: string;
}

export interface PlanBranchLaneRunSkeletonInput {
  readonly mode?: BranchLaneRunSkeletonMode;
  readonly workItem: WorkItem;
  readonly laneRunId: string;
  readonly idempotencyKey: string;
  readonly repositoryRoot: string;
  readonly worktreeRoot: string;
  readonly stateRoot: string;
  readonly branchName: string;
  readonly baseBranch?: string;
  readonly authoritativeScope?: AuthoritativeLaneRunScope;
  readonly allowedRepositoryRoots?: readonly string[];
  readonly dogfoodRepositoryAllowlist?: readonly OwnerControlledDogfoodRepositoryAllowlistEntry[];
  readonly customerRepositoryAllowlist?: readonly CustomerRepositoryAllowlistEntry[];
  readonly recordedAt?: string;
}

export interface BranchLaneRunSkeleton {
  readonly mode: BranchLaneRunSkeletonMode;
  readonly mutatesFilesystem: boolean;
  readonly startsAgentExecution: false;
  readonly createsBranch: false;
  readonly opensChangeRequest: false;
  readonly laneRunId: string;
  readonly workItem: WorkItem;
  readonly repository: {
    readonly classification: LaneRepositoryClassification;
    readonly id: string;
    readonly slug: string;
    readonly url?: string;
    readonly ownerIdentity?: string;
  };
  readonly branch: {
    readonly name: string;
    readonly base: string;
  };
  readonly worktree: {
    readonly path: string;
  };
  readonly state: {
    readonly root: string;
    readonly stateDirectory: string;
    readonly stateFile: string;
  };
  readonly idempotency: {
    readonly key: string;
    readonly intent: string;
  };
  readonly providerState: {
    readonly agentProviderSessionCreated: false;
    readonly scmBranchCreated: false;
    readonly scmWorktreeCreated: false;
    readonly changeRequestCreated: false;
  };
  readonly cleanup: {
    readonly intent: string;
  };
  readonly localSkeleton?: PreparedLocalLaneWorkspace;
  readonly laneRunStatePath?: string;
}

export const preparedLocalLaneMarkerFilename = ".ensen-loop-prepared.json";
export const preparedLocalLaneMarkerSchemaVersion = "ensen.local-lane-prepared.v1";

const laneRunIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const localLaneDirectoryNamePattern = /^[A-Za-z0-9._-]{1,128}$/;
const stableWorkItemIdPattern = /^[a-z0-9][a-z0-9._-]{0,159}$/;
const laneIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const branchNamePattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/;
const repositorySlugPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const idempotencyIntentPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{11,159}$/;
const laneRunMutationLockStaleMs = 5 * 60 * 1000;
const laneRunMutationLockOwnerFilename = "owner.json";
const windowsReservedFilenameStems = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "clock$",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);
const isoDateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const laneRunStatuses = new Set<unknown>([
  "queued",
  "running",
  "verifying",
  "reviewing",
  "blocked",
  "completed",
  "failed",
]);
const laneRunQueueStatuses = new Set<unknown>(["queued", "completed", "revoked", "superseded"]);
const laneRunLockStatuses = new Set<unknown>(["active", "completed", "revoked", "superseded"]);

export function createLaneJournal(input: CreateLaneJournalInput): LaneJournal {
  return {
    id: input.id,
    laneRunId: input.laneRunId,
    workItemId: input.workItemId,
    entries: input.entries ?? [],
  };
}

export function createLaneRunState(input: CreateLaneRunStateInput): LaneRunState {
  return {
    id: input.id,
    workItemId: input.workItemId,
    status: input.status,
    revision: input.revision,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    startsAgentExecution: false,
    journal: input.journal,
    audit: input.audit ?? { eventRefs: [] },
    evidence: input.evidence ?? { bundleRefs: [] },
  };
}

export function resolveLocalLaneDirectoryName(
  input: Pick<PrepareLocalLaneWorkspaceInput, "laneRunId" | "workItemId">,
): string {
  const identifier = input.laneRunId ?? input.workItemId;

  if (typeof identifier !== "string" || identifier.length === 0) {
    throw new Error("A lane run identifier or work item identifier is required for local lane preparation.");
  }

  if (!localLaneDirectoryNamePattern.test(identifier)) {
    throw new Error("Local lane identifiers may only contain letters, numbers, dots, underscores, and hyphens.");
  }

  if (!/[A-Za-z0-9]/.test(identifier)) {
    throw new Error("Local lane identifiers must include at least one letter or number.");
  }

  return identifier;
}

export async function prepareLocalLaneWorkspace(
  input: PrepareLocalLaneWorkspaceInput,
): Promise<PreparedLocalLaneWorkspace> {
  const directoryName = resolveLocalLaneDirectoryName(input);
  const workspaceRoot = await resolveCanonicalLocalLaneRoot("workspace", input.workspaceRoot);
  const stateRoot = await resolveCanonicalLocalLaneRoot("state", input.stateRoot);

  if (workspaceRoot.realPath === stateRoot.realPath) {
    throw new Error("Local lane workspace root and state root must be separate directories.");
  }

  let workspaceResult: PreparedLocalLanePath | undefined;

  try {
    workspaceResult = await prepareLocalLanePath("workspace", workspaceRoot, directoryName);
    const stateResult = await prepareLocalLanePath("state", stateRoot, directoryName);
    await writePreparedLocalLaneMarker(workspaceResult.path, directoryName);
    await writePreparedLocalLaneMarker(stateResult.path, directoryName);

    return {
      directoryName,
      workspacePath: workspaceResult.path,
      statePath: stateResult.path,
      created: {
        workspace: workspaceResult.created,
        state: stateResult.created,
      },
    };
  } catch (error) {
    if (workspaceResult?.created) {
      await rm(workspaceResult.path, { recursive: true, force: true });
    }

    throw error;
  }
}

export async function planBranchLaneRunSkeleton(
  input: PlanBranchLaneRunSkeletonInput,
): Promise<BranchLaneRunSkeleton> {
  const mode = input.mode ?? "dry-run";

  if (mode !== "dry-run" && mode !== "prepare") {
    throw new Error("Lane skeleton mode must be dry-run or prepare.");
  }

  assertReadyWorkItem(input.workItem);
  assertSafeBranchName(input.branchName);
  assertSafeBranchName(input.baseBranch ?? "main");
  assertSafeIdempotencyKey(input.idempotencyKey);

  const laneRunId = resolveLocalLaneDirectoryName({
    laneRunId: input.laneRunId,
    workItemId: input.workItem.id,
  });
  const scope = input.authoritativeScope;

  if (scope === undefined) {
    throw new Error("An authoritative repository scope is required before lane skeleton planning.");
  }

  validateAuthoritativeLaneRunScope(scope);
  const repositoryClassification = resolveLaneRepositoryClassification(scope);

  const repositoryRoot = await resolveCanonicalRepositoryRoot(input.repositoryRoot);
  const scopedRepositoryRoot = await resolveCanonicalRepositoryRoot(scope.repositoryRoot);

  if (repositoryRoot.realPath !== scopedRepositoryRoot.realPath) {
    throw new Error("Repository root must match the authoritative repository scope.");
  }

  if (input.allowedRepositoryRoots !== undefined) {
    await assertRepositoryRootAllowlisted(repositoryRoot.realPath, input.allowedRepositoryRoots);
  }

  if (mode === "prepare") {
    if (repositoryClassification === "customer-repository") {
      await assertCustomerRepositoryAllowlisted({
        scope,
        repositoryRealPath: repositoryRoot.realPath,
        allowlist: input.customerRepositoryAllowlist,
        required: true,
      });
    } else {
      await assertDogfoodRepositoryAllowlisted({
        scope,
        repositoryRealPath: repositoryRoot.realPath,
        allowlist: input.dogfoodRepositoryAllowlist,
        required: true,
      });
    }
  }

  const worktreeRoot = await resolveCanonicalLocalLaneRoot("workspace", input.worktreeRoot);
  const stateRoot = await resolveCanonicalLocalLaneRoot("state", input.stateRoot);

  if (worktreeRoot.realPath === stateRoot.realPath) {
    throw new Error("Local lane worktree root and state root must be separate directories.");
  }

  const stateFile = resolveLaneRunStatePath(stateRoot.inputPath, laneRunId);
  const stateDirectory = path.join(stateRoot.inputPath, "lane-runs", laneRunId);
  const skeletonBase = {
    mode,
    mutatesFilesystem: mode === "prepare",
    startsAgentExecution: false,
    createsBranch: false,
    opensChangeRequest: false,
    laneRunId,
    workItem: { ...input.workItem },
    repository: createLaneRepositoryProjection(scope, repositoryClassification),
    branch: {
      name: input.branchName,
      base: input.baseBranch ?? "main",
    },
    worktree: {
      path: path.join(worktreeRoot.inputPath, "lane-runs", laneRunId),
    },
    state: {
      root: stateRoot.inputPath,
      stateDirectory,
      stateFile,
    },
    idempotency: {
      key: input.idempotencyKey,
      intent: "deduplicate later provider submit binding without starting execution",
    },
    providerState: {
      agentProviderSessionCreated: false,
      scmBranchCreated: false,
      scmWorktreeCreated: false,
      changeRequestCreated: false,
    },
    cleanup: {
      intent: `cleanup: remove prepared local lane workspace and state directory for ${laneRunId}`,
    },
  } satisfies Omit<BranchLaneRunSkeleton, "localSkeleton" | "laneRunStatePath">;

  if (mode === "dry-run") {
    return skeletonBase;
  }

  const localSkeleton = await prepareLocalLaneWorkspace({
    workspaceRoot: worktreeRoot.inputPath,
    stateRoot: stateRoot.inputPath,
    laneRunId,
    workItemId: input.workItem.id,
  });
  const recordedAt = input.recordedAt ?? new Date().toISOString();
  const scopeJournalEntries =
    repositoryClassification === "customer-repository"
      ? [
          {
            id: `${laneRunId}-scope`,
            recordedAt,
            kind: "hypothesis" as const,
            message: "authoritative scope: customer-repository",
          },
          {
            id: `${laneRunId}-customer-allowlist`,
            recordedAt,
            kind: "hypothesis" as const,
            message: "customer repo allowlist matched: owner, repo, path, purpose, and approval note",
          },
        ]
      : [
          {
            id: `${laneRunId}-scope`,
            recordedAt,
            kind: "hypothesis" as const,
            message: `authoritative scope: ${scope.repositorySlug} ${scope.repositoryId}`,
          },
          {
            id: `${laneRunId}-dogfood-allowlist`,
            recordedAt,
            kind: "hypothesis" as const,
            message: `dogfood allowlist matched: ${scope.repositorySlug} ownerIdentity=${scope.ownerIdentity ?? "<missing>"}`,
          },
        ];
  const state = createLaneRunState({
    id: laneRunId,
    workItemId: input.workItem.id,
    status: "queued",
    revision: 1,
    createdAt: recordedAt,
    updatedAt: recordedAt,
    journal: createLaneJournal({
      id: `journal-${laneRunId}`,
      laneRunId,
      workItemId: input.workItem.id,
      entries: [
        ...scopeJournalEntries,
        {
          id: `${laneRunId}-branch`,
          recordedAt,
          kind: "change",
          message: `branch intent: ${input.branchName} from ${input.baseBranch ?? "main"}`,
        },
        {
          id: `${laneRunId}-idempotency`,
          recordedAt,
          kind: "change",
          message: `idempotency key: ${input.idempotencyKey}`,
        },
        {
          id: `${laneRunId}-cleanup`,
          recordedAt,
          kind: "next-action",
          message: skeletonBase.cleanup.intent,
        },
      ],
    }),
  });
  let laneRunStatePath: string | undefined;

  try {
    laneRunStatePath = await writeLaneRunState(stateRoot.inputPath, state);
  } catch (error) {
    if (localSkeleton.created.workspace) {
      await rm(localSkeleton.workspacePath, { recursive: true, force: true });
    }
    if (localSkeleton.created.state) {
      await rm(localSkeleton.statePath, { recursive: true, force: true });
    }
    throw error;
  }

  return {
    ...skeletonBase,
    localSkeleton,
    laneRunStatePath,
  };
}

export function serializeLaneRunState(state: LaneRunState): string {
  return JSON.stringify(toSerializableLaneRunState(state), null, 2);
}

export function resolveLaneRunStatePath(stateRoot: string, laneRunId: string): string {
  if (!laneRunIdPattern.test(laneRunId)) {
    throw new Error("Lane run identifiers may only contain letters, numbers, dots, underscores, and hyphens.");
  }

  const resolvedRoot = path.resolve(stateRoot);
  const laneRunsRoot = path.join(resolvedRoot, "lane-runs");
  const statePath = path.join(laneRunsRoot, `${laneRunId}.json`);
  const relativePath = path.relative(resolvedRoot, statePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Lane run state paths must stay inside the configured state root.");
  }

  return statePath;
}

export async function writeLaneRunState(stateRoot: string, state: LaneRunState): Promise<string> {
  const validatedState = validateLaneRunStateForWrite(state);
  const statePath = resolveLaneRunStatePath(stateRoot, validatedState.id);

  const realRoot = await assertLaneRunStatePathSafeForWrite(stateRoot, statePath);
  await mkdir(path.dirname(statePath), { recursive: true });
  await assertLaneRunStatePathSafeForWrite(stateRoot, statePath);

  const file = await open(
    statePath,
    constants.O_RDWR | constants.O_CREAT | noFollowFlag() | nonBlockingFlag(),
    0o600,
  );

  try {
    await assertOpenedLaneRunStateFileSafeForAccess(realRoot, statePath, file);
    await file.truncate(0);
    await file.writeFile(`${serializeLaneRunState(validatedState)}\n`, "utf8");
  } finally {
    await file.close();
  }

  return statePath;
}

export async function readLaneRunState(stateRoot: string, laneRunId: string): Promise<LaneRunState> {
  const statePath = resolveLaneRunStatePath(stateRoot, laneRunId);
  const realRoot = await assertLaneRunStatePathSafeForRead(stateRoot, statePath);

  const file = await open(statePath, constants.O_RDONLY | noFollowFlag() | nonBlockingFlag());
  let contents: string;

  try {
    await assertOpenedLaneRunStateFileSafeForAccess(realRoot, statePath, file);
    contents = await file.readFile("utf8");
  } finally {
    await file.close();
  }

  const parsed = JSON.parse(contents) as unknown;
  const state = parseLaneRunState(parsed);

  if (
    state.id !== laneRunId ||
    state.journal.laneRunId !== laneRunId ||
    state.journal.workItemId !== state.workItemId
  ) {
    throw new Error("Lane run state identifiers do not match the requested lane run.");
  }

  return state;
}

export function resolveLaneRunQueueRecordPath(stateRoot: string, stableWorkItemId: string): string {
  assertSafeStableWorkItemId(stableWorkItemId);

  const resolvedRoot = path.resolve(stateRoot);
  const queueRoot = path.join(resolvedRoot, "lane-run-queue");
  const queuePath = path.join(queueRoot, `${stableWorkItemId}.json`);
  const relativePath = path.relative(resolvedRoot, queuePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Lane run queue paths must stay inside the configured state root.");
  }

  return queuePath;
}

export function resolveLaneRunLockPath(stateRoot: string, stableWorkItemId: string): string {
  assertSafeStableWorkItemId(stableWorkItemId);

  const resolvedRoot = path.resolve(stateRoot);
  const lockRoot = path.join(resolvedRoot, "lane-run-locks");
  const lockPath = path.join(lockRoot, `${stableWorkItemId}.json`);
  const relativePath = path.relative(resolvedRoot, lockPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Lane run lock paths must stay inside the configured state root.");
  }

  return lockPath;
}

export async function enqueueLaneRun(
  stateRoot: string,
  input: EnqueueLaneRunInput,
): Promise<LaneRunQueueRecord> {
  assertSafeStableWorkItemId(input.stableWorkItemId);
  assertSafeLaneQueueMetadata(input);

  const record = toSerializableLaneRunQueueRecord({
    schemaVersion: "ensen.lane-run-queue.v1",
    id: `queue-${input.stableWorkItemId}`,
    stableWorkItemId: input.stableWorkItemId,
    workItemId: input.workItemId,
    source: input.source,
    laneId: input.laneId,
    repositoryClassification: input.repositoryClassification,
    status: "queued",
    queuedAt: input.queuedAt,
    updatedAt: input.queuedAt,
    startsAgentExecution: false,
    metadata: input.metadata ?? {},
    publicDiagnostics: {
      stableWorkItemId: input.stableWorkItemId,
      laneId: input.laneId,
      source: input.source,
      repositoryClassification: input.repositoryClassification,
      status: "queued",
    },
  });

  await withLaneRunMutationLock(stateRoot, input.stableWorkItemId, async () => {
    await assertNoActiveLaneRunLockForEnqueue(stateRoot, input.stableWorkItemId);
    await writeLaneRunQueueRecord(stateRoot, record);
  });

  return record;
}

export async function readLaneRunQueueRecord(
  stateRoot: string,
  stableWorkItemId: string,
): Promise<LaneRunQueueRecord> {
  const queuePath = resolveLaneRunQueueRecordPath(stateRoot, stableWorkItemId);
  const parsed = await readJsonStateFile(stateRoot, queuePath);
  const record = parseLaneRunQueueRecord(parsed);

  if (record.stableWorkItemId !== stableWorkItemId) {
    throw new Error("Lane run queue record identifiers do not match the requested work item.");
  }

  return record;
}

export async function claimQueuedLaneRun(
  stateRoot: string,
  input: ClaimQueuedLaneRunInput,
): Promise<ClaimQueuedLaneRunResult> {
  assertSafeStableWorkItemId(input.stableWorkItemId);

  if (!isLaneRunId(input.laneRunId) || !isNonEmptyString(input.claimedBy) || !isIsoDateTime(input.claimedAt)) {
    throw new Error("Lane run claim input is malformed.");
  }

  return withLaneRunMutationLock(stateRoot, input.stableWorkItemId, async () => {
    const queueRecord = await readLaneRunQueueRecord(stateRoot, input.stableWorkItemId);

    if (queueRecord.status !== "queued") {
      throw new Error(`Lane run queue record is not claimable: ${queueRecord.status}.`);
    }

    const existingLock = await readOptionalLaneRunLock(stateRoot, input.stableWorkItemId);

    if (existingLock?.active === true) {
      const reason = `already claimed by active lane run ${existingLock.laneRunId}`;

      return {
        ok: false,
        reason,
        lock: existingLock,
        publicDiagnostics: createLaneRunLockDiagnostics(existingLock, reason),
      };
    }

    const lock = toSerializableLaneRunLock({
      schemaVersion: "ensen.lane-run-lock.v1",
      stableWorkItemId: queueRecord.stableWorkItemId,
      queueRecordId: queueRecord.id,
      laneRunId: input.laneRunId,
      laneId: queueRecord.laneId,
      source: queueRecord.source,
      repositoryClassification: queueRecord.repositoryClassification,
      status: "active",
      active: true,
      claimedAt: input.claimedAt,
      claimedBy: input.claimedBy,
      startsAgentExecution: false,
    });

    await writeLaneRunLock(stateRoot, lock);

    return {
      ok: true,
      lock,
      publicDiagnostics: createLaneRunLockDiagnostics(lock, "claimed"),
    };
  });
}

export async function readLaneRunLock(stateRoot: string, stableWorkItemId: string): Promise<LaneRunLock> {
  const lockPath = resolveLaneRunLockPath(stateRoot, stableWorkItemId);
  const parsed = await readJsonStateFile(stateRoot, lockPath);
  const lock = parseLaneRunLock(parsed);

  if (lock.stableWorkItemId !== stableWorkItemId) {
    throw new Error("Lane run lock identifiers do not match the requested work item.");
  }

  return lock;
}

export async function completeLaneRunLock(
  stateRoot: string,
  input: CompleteLaneRunLockInput,
): Promise<LaneRunLock> {
  assertSafeStableWorkItemId(input.stableWorkItemId);

  if (
    !isLaneRunId(input.laneRunId) ||
    !isIsoDateTime(input.completedAt) ||
    !laneRunLockStatuses.has(input.terminalStatus) ||
    String(input.terminalStatus) === "active"
  ) {
    throw new Error("Lane run lock completion input is malformed.");
  }

  return withLaneRunMutationLock(stateRoot, input.stableWorkItemId, async () => {
    const existingLock = await readLaneRunLock(stateRoot, input.stableWorkItemId);

    if (existingLock.laneRunId !== input.laneRunId) {
      throw new Error("Lane run lock completion does not match the active lane run.");
    }

    if (existingLock.status !== "active" || existingLock.active !== true) {
      throw new Error(`Lane run lock is already terminal: ${existingLock.status}.`);
    }

    const queueRecord = await readLaneRunQueueRecord(stateRoot, input.stableWorkItemId);
    const completedLock = toSerializableLaneRunLock({
      ...existingLock,
      status: input.terminalStatus,
      active: false,
      releasedAt: input.completedAt,
    });
    const completedQueueRecord = toSerializableLaneRunQueueRecord({
      ...queueRecord,
      status: input.terminalStatus,
      updatedAt: input.completedAt,
      publicDiagnostics: {
        ...queueRecord.publicDiagnostics,
        status: input.terminalStatus,
      },
    });

    await persistCompletedLaneRunState(stateRoot, queueRecord, completedQueueRecord, completedLock);

    return completedLock;
  });
}

async function persistCompletedLaneRunState(
  stateRoot: string,
  previousQueueRecord: LaneRunQueueRecord,
  completedQueueRecord: LaneRunQueueRecord,
  completedLock: LaneRunLock,
): Promise<void> {
  await writeLaneRunQueueRecord(stateRoot, completedQueueRecord);

  try {
    await writeLaneRunLock(stateRoot, completedLock);
  } catch (error) {
    await writeLaneRunQueueRecord(stateRoot, previousQueueRecord);
    throw error;
  }
}

async function withLaneRunMutationLock<T>(
  stateRoot: string,
  stableWorkItemId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const release = await acquireLaneRunMutationLock(stateRoot, stableWorkItemId);

  try {
    return await operation();
  } finally {
    await release();
  }
}

async function acquireLaneRunMutationLock(
  stateRoot: string,
  stableWorkItemId: string,
): Promise<() => Promise<void>> {
  const lockPath = resolveLaneRunMutationLockPath(stateRoot, stableWorkItemId);
  const lockRoot = path.dirname(lockPath);
  const owner: LaneRunMutationLockOwner = {
    schemaVersion: "ensen.lane-run-mutation-lock-owner.v1",
    token: randomUUID(),
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  };

  await mkdir(lockRoot, { recursive: true });
  const realRoot = await resolveCanonicalStateRoot(stateRoot);
  await assertExistingPathSafe(realRoot, lockRoot, "directory");

  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      await assertExistingPathSafe(realRoot, lockPath, "directory");
      await writeLaneRunMutationLockOwner(realRoot, lockPath, owner);

      return async () => {
        await releaseLaneRunMutationLock(lockPath, owner.token);
      };
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        await rm(lockPath, { recursive: true, force: true });
        throw error;
      }

      const recoveredStaleLock = await recoverStaleLaneRunMutationLock(realRoot, lockPath);

      if (recoveredStaleLock) {
        continue;
      }

      await delay(20);
    }
  }

  throw new Error("Lane run queue record is currently being modified; retry the lane run mutation.");
}

async function assertNoActiveLaneRunLockForEnqueue(stateRoot: string, stableWorkItemId: string): Promise<void> {
  const existingLock = await readOptionalLaneRunLock(stateRoot, stableWorkItemId);

  if (existingLock?.active === true) {
    throw new Error(
      `Cannot enqueue lane run while stable work item is already claimed by active lane run ${existingLock.laneRunId}.`,
    );
  }
}

async function recoverStaleLaneRunMutationLock(realRoot: string, lockPath: string): Promise<boolean> {
  let lockStats: Stats;

  try {
    lockStats = await lstat(lockPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return true;
    }

    throw error;
  }

  if (!lockStats.isDirectory()) {
    throw new Error("Lane run mutation lock path is malformed.");
  }

  if (Date.now() - lockStats.mtimeMs < laneRunMutationLockStaleMs) {
    return false;
  }

  const owner = await readOptionalLaneRunMutationLockOwner(realRoot, lockPath);

  if (owner && isProcessAlive(owner.pid)) {
    return false;
  }

  try {
    await rm(lockPath, { recursive: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return true;
    }

    throw error;
  }

  return true;
}

async function writeLaneRunMutationLockOwner(
  realRoot: string,
  lockPath: string,
  owner: LaneRunMutationLockOwner,
): Promise<void> {
  const ownerPath = path.join(lockPath, laneRunMutationLockOwnerFilename);
  const ownerFile = await open(
    ownerPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag() | nonBlockingFlag(),
    0o600,
  );

  try {
    await assertOpenedGenericStateFileSafeForAccess(realRoot, ownerPath, ownerFile);
    await ownerFile.writeFile(`${JSON.stringify(owner, null, 2)}\n`, "utf8");
  } finally {
    await ownerFile.close();
  }
}

async function readOptionalLaneRunMutationLockOwner(
  realRoot: string,
  lockPath: string,
): Promise<LaneRunMutationLockOwner | undefined> {
  const ownerPath = path.join(lockPath, laneRunMutationLockOwnerFilename);

  let contents: string;
  let file: FileHandle;

  try {
    file = await open(ownerPath, constants.O_RDONLY | noFollowFlag() | nonBlockingFlag());
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }

  try {
    await assertOpenedGenericStateFileSafeForAccess(realRoot, ownerPath, file);
    contents = await file.readFile("utf8");
  } finally {
    await file.close();
  }

  return parseLaneRunMutationLockOwner(JSON.parse(contents) as unknown);
}

async function releaseLaneRunMutationLock(lockPath: string, token: string): Promise<void> {
  const realRoot = await resolveCanonicalStateRoot(path.dirname(path.dirname(lockPath)));
  const owner = await readOptionalLaneRunMutationLockOwner(realRoot, lockPath);

  if (!owner || owner.token !== token) {
    return;
  }

  try {
    await rm(lockPath, { recursive: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }

    throw error;
  }
}

function resolveLaneRunMutationLockPath(stateRoot: string, stableWorkItemId: string): string {
  assertSafeStableWorkItemId(stableWorkItemId);

  const resolvedRoot = path.resolve(stateRoot);
  const lockRoot = path.join(resolvedRoot, "lane-run-mutation-locks");
  const lockPath = path.join(lockRoot, `${stableWorkItemId}.lock`);
  const relativePath = path.relative(resolvedRoot, lockPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Lane run mutation lock paths must stay inside the configured state root.");
  }

  return lockPath;
}

async function readOptionalLaneRunLock(
  stateRoot: string,
  stableWorkItemId: string,
): Promise<LaneRunLock | undefined> {
  try {
    return await readLaneRunLock(stateRoot, stableWorkItemId);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

async function writeLaneRunQueueRecord(stateRoot: string, record: LaneRunQueueRecord): Promise<string> {
  const validatedRecord = parseLaneRunQueueRecord(record);
  const queuePath = resolveLaneRunQueueRecordPath(stateRoot, validatedRecord.stableWorkItemId);

  await writeJsonStateFile(stateRoot, queuePath, toSerializableLaneRunQueueRecord(validatedRecord));

  return queuePath;
}

async function writeLaneRunLock(stateRoot: string, lock: LaneRunLock): Promise<string> {
  const validatedLock = parseLaneRunLock(lock);
  const lockPath = resolveLaneRunLockPath(stateRoot, validatedLock.stableWorkItemId);

  await writeJsonStateFile(stateRoot, lockPath, toSerializableLaneRunLock(validatedLock));

  return lockPath;
}

async function readJsonStateFile(stateRoot: string, statePath: string): Promise<unknown> {
  const realRoot = await assertGenericStatePathSafeForRead(stateRoot, statePath);
  const file = await open(statePath, constants.O_RDONLY | noFollowFlag() | nonBlockingFlag());
  let contents: string;

  try {
    await assertOpenedGenericStateFileSafeForAccess(realRoot, statePath, file);
    contents = await file.readFile("utf8");
  } finally {
    await file.close();
  }

  return JSON.parse(contents) as unknown;
}

async function writeJsonStateFile(
  stateRoot: string,
  statePath: string,
  value: unknown,
): Promise<void> {
  const realRoot = await assertGenericStatePathSafeForWrite(stateRoot, statePath);
  await mkdir(path.dirname(statePath), { recursive: true });
  await assertGenericStatePathSafeForWrite(stateRoot, statePath);

  const stateDirectory = path.dirname(statePath);
  const temporaryPath = path.join(stateDirectory, `.${path.basename(statePath)}.${process.pid}.${randomUUID()}.tmp`);
  const file = await open(
    temporaryPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag() | nonBlockingFlag(),
    0o600,
  );
  let writeError: unknown;

  try {
    await assertOpenedGenericStateFileSafeForAccess(realRoot, temporaryPath, file);
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await file.sync();
  } catch (error) {
    writeError = error;
  } finally {
    await file.close();
  }

  if (writeError) {
    await rm(temporaryPath, { force: true });
    throw writeError;
  }

  try {
    await assertGenericStatePathSafeForWrite(stateRoot, statePath);
    await rename(temporaryPath, statePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function assertGenericStatePathSafeForWrite(stateRoot: string, statePath: string): Promise<string> {
  const realRoot = await resolveCanonicalStateRoot(stateRoot);
  const stateDirectory = path.dirname(statePath);

  await assertExistingPathSafe(realRoot, stateDirectory, "directory");
  await assertExistingPathSafe(realRoot, statePath, "file");

  return realRoot;
}

async function assertGenericStatePathSafeForRead(stateRoot: string, statePath: string): Promise<string> {
  const realRoot = await resolveCanonicalStateRoot(stateRoot);
  const stateDirectory = path.dirname(statePath);

  await assertExistingPathSafe(realRoot, stateDirectory, "directory");
  await assertExistingPathSafe(realRoot, statePath, "file");

  return realRoot;
}

async function assertOpenedGenericStateFileSafeForAccess(
  realRoot: string,
  statePath: string,
  file: FileHandle,
): Promise<void> {
  const openedStats = await file.stat();

  if (!openedStats.isFile()) {
    throw new Error("Lane run durable state file path must be a regular file.");
  }

  const pathStats = await lstat(statePath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error("Lane run durable state file changed during access.");
    }

    throw error;
  });

  if (!sameFileStats(openedStats, pathStats)) {
    throw new Error("Lane run durable state file changed during access.");
  }

  await assertExistingPathSafe(realRoot, statePath, "file");
}

function assertSafeStableWorkItemId(stableWorkItemId: string): void {
  if (!isSafeStableWorkItemId(stableWorkItemId)) {
    throw new Error(
      "Stable work item identifiers may only contain lowercase letters, numbers, dots, underscores, and hyphens, and must not use reserved filenames.",
    );
  }
}

function isSafeStableWorkItemId(stableWorkItemId: string): boolean {
  if (!stableWorkItemIdPattern.test(stableWorkItemId)) {
    return false;
  }

  return !windowsReservedFilenameStems.has(stableWorkItemId.split(".")[0]);
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ESRCH") {
      return false;
    }

    return true;
  }
}

function assertSafeLaneQueueMetadata(input: EnqueueLaneRunInput): void {
  if (
    !isNonEmptyString(input.workItemId) ||
    !isNonEmptyString(input.source) ||
    !laneIdPattern.test(input.laneId) ||
    !isLaneRepositoryClassification(input.repositoryClassification) ||
    !isIsoDateTime(input.queuedAt) ||
    !isStringMetadata(input.metadata ?? {})
  ) {
    throw new Error("Lane run queue input is malformed.");
  }
}

function createLaneRunLockDiagnostics(lock: LaneRunLock, reason: string): LaneRunLockDiagnostics {
  return {
    stableWorkItemId: lock.stableWorkItemId,
    laneId: lock.laneId,
    source: lock.source,
    repositoryClassification: lock.repositoryClassification,
    lockStatus: lock.status,
    laneRunId: lock.laneRunId,
    reason,
  };
}

function validateLaneRunStateForWrite(state: LaneRunState): LaneRunState {
  const parsed = parseLaneRunState(state);

  if (parsed.journal.laneRunId !== parsed.id || parsed.journal.workItemId !== parsed.workItemId) {
    throw new Error("Lane run state identifiers do not match the lane run being persisted.");
  }

  return parsed;
}

async function assertLaneRunStatePathSafeForWrite(stateRoot: string, statePath: string): Promise<string> {
  const realRoot = await resolveCanonicalStateRoot(stateRoot);
  const laneRunsRoot = path.join(path.resolve(stateRoot), "lane-runs");

  await assertExistingPathSafe(realRoot, laneRunsRoot, "directory");
  await assertExistingPathSafe(realRoot, statePath, "file");

  return realRoot;
}

async function assertLaneRunStatePathSafeForRead(stateRoot: string, statePath: string): Promise<string> {
  const realRoot = await resolveCanonicalStateRoot(stateRoot);
  const laneRunsRoot = path.join(path.resolve(stateRoot), "lane-runs");

  await assertExistingPathSafe(realRoot, laneRunsRoot, "directory");
  await assertExistingPathSafe(realRoot, statePath, "file");

  return realRoot;
}

async function resolveCanonicalStateRoot(stateRoot: string): Promise<string> {
  const resolvedRoot = path.resolve(stateRoot);
  const stats = await lstat(resolvedRoot).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error("Configured state root must exist before lane run state is accessed.");
    }

    throw error;
  });

  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("Configured state root must be a real directory.");
  }

  return realpath(resolvedRoot);
}

interface PreparedLocalLanePath {
  readonly path: string;
  readonly created: boolean;
}

interface CanonicalLocalLaneRoot {
  readonly inputPath: string;
  readonly realPath: string;
}

function assertReadyWorkItem(workItem: WorkItem): void {
  if (!isNonEmptyString(workItem.id) || !isNonEmptyString(workItem.title) || !isNonEmptyString(workItem.source)) {
    throw new Error("WorkItem scope is malformed.");
  }

  if (workItem.status !== "ready") {
    throw new Error("WorkItem must be ready before lane skeleton planning.");
  }
}

function assertSafeIdempotencyKey(idempotencyKey: string): void {
  if (!idempotencyIntentPattern.test(idempotencyKey)) {
    throw new Error("Idempotency key is unsafe for lane skeleton planning.");
  }
}

function assertSafeBranchName(branchName: string): void {
  if (
    !branchNamePattern.test(branchName) ||
    branchName.includes("..") ||
    branchName.includes("//") ||
    branchName.includes("@{") ||
    branchName.includes("\\") ||
    branchName.endsWith("/") ||
    branchName.endsWith(".") ||
    branchName.endsWith(".lock") ||
    branchName.startsWith(".") ||
    branchName.includes(" ")
  ) {
    throw new Error("Branch name is unsafe for lane skeleton planning.");
  }
}

function validateAuthoritativeLaneRunScope(scope: AuthoritativeLaneRunScope): void {
  const classification = resolveLaneRepositoryClassification(scope);

  if (
    !isNonEmptyString(scope.repositoryId) ||
    !repositorySlugPattern.test(scope.repositorySlug) ||
    !isNonEmptyString(scope.repositoryRoot)
  ) {
    throw new Error("Authoritative repository scope is malformed.");
  }

  if (classification === "owner-controlled-dogfood" && scope.ownerControlled !== true) {
    throw new Error("Authoritative repository scope is malformed.");
  }

  if (classification === "customer-repository") {
    const scopeIssues = collectCustomerScopeIssues(scope);

    if (scopeIssues.length > 0) {
      throw new Error(`Customer repository scope is missing or malformed: ${scopeIssues.join(", ")}.`);
    }
  }
}

function resolveLaneRepositoryClassification(scope: AuthoritativeLaneRunScope): LaneRepositoryClassification {
  if (scope.repositoryClassification === undefined) {
    return "owner-controlled-dogfood";
  }

  if (
    scope.repositoryClassification === "owner-controlled-dogfood" ||
    scope.repositoryClassification === "customer-repository"
  ) {
    return scope.repositoryClassification;
  }

  throw new Error("Authoritative repository classification is unsupported.");
}

function createLaneRepositoryProjection(
  scope: AuthoritativeLaneRunScope,
  classification: LaneRepositoryClassification,
): BranchLaneRunSkeleton["repository"] {
  if (classification === "customer-repository") {
    return {
      classification,
      id: CUSTOMER_REPOSITORY_PLACEHOLDER,
      slug: CUSTOMER_REPOSITORY_PLACEHOLDER,
    };
  }

  return {
    classification,
    id: scope.repositoryId,
    slug: scope.repositorySlug,
    url: scope.repositoryUrl,
    ownerIdentity: scope.ownerIdentity,
  };
}

async function assertRepositoryRootAllowlisted(
  repositoryRealPath: string,
  allowedRepositoryRoots: readonly string[],
): Promise<void> {
  for (const allowedRoot of allowedRepositoryRoots) {
    const allowed = await resolveCanonicalRepositoryRoot(allowedRoot);

    if (allowed.realPath === repositoryRealPath) {
      return;
    }
  }

  throw new Error("Repository root is not allowlisted for lane skeleton planning.");
}

async function assertDogfoodRepositoryAllowlisted(input: {
  readonly scope: AuthoritativeLaneRunScope;
  readonly repositoryRealPath: string;
  readonly allowlist?: readonly OwnerControlledDogfoodRepositoryAllowlistEntry[];
  readonly required: boolean;
}): Promise<void> {
  if (!Array.isArray(input.allowlist)) {
    if (input.required) {
      throw new Error("Owner-controlled dogfood repository allowlist is required before prepare mutation.");
    }

    return;
  }

  const scopeIssues = collectDogfoodScopeIssues(input.scope);
  if (scopeIssues.length > 0) {
    throw new Error(`Dogfood repository scope is missing or malformed: ${scopeIssues.join(", ")}.`);
  }

  const entryIssues = collectDogfoodAllowlistEntryIssues(input.allowlist);
  if (entryIssues.length > 0) {
    throw new Error(`Dogfood repository allowlist is malformed: ${entryIssues.join(", ")}.`);
  }

  for (const entry of input.allowlist) {
    if (
      entry.ownerControlled === true &&
      entry.ownerIdentity === input.scope.ownerIdentity &&
      entry.repositorySlug === input.scope.repositorySlug &&
      entry.repositoryUrl === input.scope.repositoryUrl
    ) {
      const allowed = await resolveCanonicalRepositoryRoot(entry.repositoryRoot);

      if (allowed.realPath === input.repositoryRealPath) {
        return;
      }
    }
  }

  throw new Error(
    "Dogfood repository allowlist match is required before prepare mutation; mismatched fields may include ownerIdentity, repositorySlug, repositoryUrl, or repositoryRoot.",
  );
}

async function assertCustomerRepositoryAllowlisted(input: {
  readonly scope: AuthoritativeLaneRunScope;
  readonly repositoryRealPath: string;
  readonly allowlist?: readonly CustomerRepositoryAllowlistEntry[];
  readonly required: boolean;
}): Promise<void> {
  if (!Array.isArray(input.allowlist)) {
    if (input.required) {
      throw new Error("Customer repository allowlist is required before customer lane preparation.");
    }

    return;
  }

  const scopeIssues = collectCustomerScopeIssues(input.scope);
  if (scopeIssues.length > 0) {
    throw new Error(`Customer repository scope is missing or malformed: ${scopeIssues.join(", ")}.`);
  }

  const entryIssues = collectCustomerAllowlistEntryIssues(input.allowlist);
  if (entryIssues.length > 0) {
    throw new Error(`Customer repository allowlist is malformed: ${entryIssues.join(", ")}.`);
  }

  const scopeSlug = splitRepositorySlug(input.scope.repositorySlug);

  for (const entry of input.allowlist) {
    if (
      entry.repositoryClassification === "customer-repository" &&
      entry.owner === scopeSlug.owner &&
      entry.repo === scopeSlug.repo &&
      entry.purpose === input.scope.customerRepositoryPurpose &&
      entry.approvalNote === input.scope.customerApprovalNote
    ) {
      const allowed = await resolveCanonicalRepositoryRoot(entry.repositoryRoot);

      if (allowed.realPath === input.repositoryRealPath) {
        return;
      }
    }
  }

  throw new Error(
    "Customer repository allowlist match is required before customer lane preparation; mismatched fields may include owner, repo, repositoryRoot, purpose, or approvalNote.",
  );
}

function collectDogfoodScopeIssues(scope: AuthoritativeLaneRunScope): string[] {
  const issues: string[] = [];

  if (scope.ownerControlled !== true) {
    issues.push("ownerControlled");
  }

  if (!isNonEmptyString(scope.ownerIdentity)) {
    issues.push("ownerIdentity");
  }

  if (!repositorySlugPattern.test(scope.repositorySlug)) {
    issues.push("repositorySlug");
  }

  if (!isRepositoryUrl(scope.repositoryUrl)) {
    issues.push("repositoryUrl");
  }

  if (!isNonEmptyString(scope.repositoryRoot)) {
    issues.push("repositoryRoot");
  }

  return issues;
}

function collectCustomerScopeIssues(scope: AuthoritativeLaneRunScope): string[] {
  const issues: string[] = [];

  if (scope.repositoryClassification !== "customer-repository") {
    issues.push("repositoryClassification");
  }

  if (scope.ownerControlled === true) {
    issues.push("ownerControlled");
  }

  if (!repositorySlugPattern.test(scope.repositorySlug)) {
    issues.push("repositorySlug");
  }

  if (!isNonEmptyString(scope.repositoryRoot)) {
    issues.push("repositoryRoot");
  }

  if (!isTrustedPolicyText(scope.customerRepositoryPurpose)) {
    issues.push("customerRepositoryPurpose");
  }

  if (!isTrustedPolicyText(scope.customerApprovalNote)) {
    issues.push("customerApprovalNote");
  }

  return issues;
}

function collectDogfoodAllowlistEntryIssues(
  allowlist: readonly OwnerControlledDogfoodRepositoryAllowlistEntry[],
): string[] {
  const issues: string[] = [];

  allowlist.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      issues.push(`allowlist[${index}]`);
      return;
    }

    if (entry.ownerControlled !== true) {
      issues.push(`allowlist[${index}].ownerControlled`);
    }

    if (!isNonEmptyString(entry.ownerIdentity)) {
      issues.push(`allowlist[${index}].ownerIdentity`);
    }

    if (!repositorySlugPattern.test(entry.repositorySlug)) {
      issues.push(`allowlist[${index}].repositorySlug`);
    }

    if (!isRepositoryUrl(entry.repositoryUrl)) {
      issues.push(`allowlist[${index}].repositoryUrl`);
    }

    if (!isNonEmptyString(entry.repositoryRoot)) {
      issues.push(`allowlist[${index}].repositoryRoot`);
    }
  });

  return issues;
}

function collectCustomerAllowlistEntryIssues(
  allowlist: readonly CustomerRepositoryAllowlistEntry[],
): string[] {
  const issues: string[] = [];

  allowlist.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      issues.push(`allowlist[${index}]`);
      return;
    }

    if (entry.repositoryClassification !== "customer-repository") {
      issues.push(`allowlist[${index}].repositoryClassification`);
    }

    if (!isRepositorySlugPart(entry.owner)) {
      issues.push(`allowlist[${index}].owner`);
    }

    if (!isRepositorySlugPart(entry.repo)) {
      issues.push(`allowlist[${index}].repo`);
    }

    if (!isNonEmptyString(entry.repositoryRoot)) {
      issues.push(`allowlist[${index}].repositoryRoot`);
    }

    if (!isTrustedPolicyText(entry.purpose)) {
      issues.push(`allowlist[${index}].purpose`);
    }

    if (!isTrustedPolicyText(entry.approvalNote)) {
      issues.push(`allowlist[${index}].approvalNote`);
    }
  });

  return issues;
}

function splitRepositorySlug(repositorySlug: string): { readonly owner: string; readonly repo: string } {
  const [owner, repo] = repositorySlug.split("/");

  return {
    owner: owner ?? "",
    repo: repo ?? "",
  };
}

function isRepositorySlugPart(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.-]+$/.test(value);
}

function isTrustedPolicyText(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const trimmedValue = value.trim();

  return trimmedValue.length > 0 && !isPlaceholderPolicyText(trimmedValue);
}

function isPlaceholderPolicyText(value: string): boolean {
  return (
    /^(?:todo|tbd)(?:\b|[-_ .:/#]).*/i.test(value) ||
    /^(?:sample|placeholder|example|fake)(?:[-_ .:/#]*\d*)?$/i.test(value)
  );
}

function isRepositoryUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }

  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function resolveCanonicalRepositoryRoot(rootPath: string): Promise<CanonicalLocalLaneRoot> {
  if (!path.isAbsolute(rootPath)) {
    throw new Error("Repository root must be an absolute path.");
  }

  const resolvedRoot = path.resolve(rootPath);
  const stats = await lstat(resolvedRoot).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error("Repository root must exist before lane skeleton planning.");
    }

    throw error;
  });

  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("Repository root must be a real directory.");
  }

  return {
    inputPath: resolvedRoot,
    realPath: await realpath(resolvedRoot),
  };
}

async function resolveCanonicalLocalLaneRoot(
  kind: "workspace" | "state",
  rootPath: string,
): Promise<CanonicalLocalLaneRoot> {
  if (!path.isAbsolute(rootPath)) {
    throw new Error(`Local lane ${kind} root must be an absolute path.`);
  }

  const stats = await lstat(rootPath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`Local lane ${kind} root must exist before preparation.`);
    }

    throw error;
  });

  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Local lane ${kind} root must be a real directory.`);
  }

  return {
    inputPath: path.resolve(rootPath),
    realPath: await realpath(rootPath),
  };
}

async function prepareLocalLanePath(
  kind: "workspace" | "state",
  root: CanonicalLocalLaneRoot,
  directoryName: string,
): Promise<PreparedLocalLanePath> {
  const laneRunsRoot = path.join(root.inputPath, "lane-runs");
  await ensureLocalLaneDirectory(kind, root, laneRunsRoot);

  const lanePath = path.join(laneRunsRoot, directoryName);
  const existingStats = await lstat(lanePath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  });
  let created = false;

  if (!existingStats) {
    await mkdir(lanePath);
    created = true;
  } else if (existingStats.isSymbolicLink()) {
    throw new Error(`Local lane ${kind} path must not traverse symbolic links.`);
  } else if (!existingStats.isDirectory()) {
    throw new Error(`Local lane ${kind} path must be a real directory.`);
  }

  await assertLocalLanePathInsideRoot(kind, root, lanePath);

  return {
    path: lanePath,
    created,
  };
}

async function ensureLocalLaneDirectory(
  kind: "workspace" | "state",
  root: CanonicalLocalLaneRoot,
  directoryPath: string,
): Promise<void> {
  const stats = await lstat(directoryPath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  });

  if (!stats) {
    await mkdir(directoryPath);
    await assertLocalLanePathInsideRoot(kind, root, directoryPath);
    return;
  }

  if (stats.isSymbolicLink()) {
    throw new Error(`Local lane ${kind} path must not traverse symbolic links.`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`Local lane ${kind} path must be a real directory.`);
  }

  await assertLocalLanePathInsideRoot(kind, root, directoryPath);
}

async function assertLocalLanePathInsideRoot(
  kind: "workspace" | "state",
  root: CanonicalLocalLaneRoot,
  candidatePath: string,
): Promise<void> {
  const stats = await lstat(candidatePath);

  if (stats.isSymbolicLink()) {
    throw new Error(`Local lane ${kind} path must not traverse symbolic links.`);
  }

  const realCandidate = await realpath(candidatePath);
  const relativePath = path.relative(root.realPath, realCandidate);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Local lane ${kind} path must stay inside the configured root.`);
  }
}

async function assertExistingPathSafe(
  realRoot: string,
  candidatePath: string,
  expectedKind: "directory" | "file",
): Promise<void> {
  const stats = await lstat(candidatePath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  });

  if (!stats) {
    return;
  }

  if (stats.isSymbolicLink()) {
    throw new Error("Lane run state paths must not traverse symbolic links.");
  }

  if (expectedKind === "directory" && !stats.isDirectory()) {
    throw new Error("Lane run state directory path must be a real directory.");
  }

  if (expectedKind === "file" && !stats.isFile()) {
    throw new Error("Lane run state file path must be a regular file.");
  }

  const realCandidate = await realpath(candidatePath);
  const relativePath = path.relative(realRoot, realCandidate);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Lane run state paths must stay inside the configured state root.");
  }
}

function noFollowFlag(): number {
  return typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
}

function nonBlockingFlag(): number {
  return typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0;
}

async function assertOpenedLaneRunStateFileSafeForAccess(
  realRoot: string,
  statePath: string,
  file: FileHandle,
): Promise<void> {
  const openedStats = await file.stat();

  if (!openedStats.isFile()) {
    throw new Error("Lane run state file path must be a regular file.");
  }

  const pathStats = await lstat(statePath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error("Lane run state file changed during access.");
    }

    throw error;
  });

  if (!sameFileStats(openedStats, pathStats)) {
    throw new Error("Lane run state file changed during access.");
  }

  await assertExistingPathSafe(realRoot, statePath, "file");
}

function sameFileStats(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function toSerializableLaneRunState(state: LaneRunState): LaneRunState {
  return {
    id: state.id,
    workItemId: state.workItemId,
    status: state.status,
    revision: state.revision,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    startsAgentExecution: state.startsAgentExecution,
    journal: {
      id: state.journal.id,
      laneRunId: state.journal.laneRunId,
      workItemId: state.journal.workItemId,
      entries: state.journal.entries.map((entry) => ({
        id: entry.id,
        recordedAt: entry.recordedAt,
        kind: entry.kind,
        message: entry.message,
      })),
    },
    audit: {
      eventRefs: [...state.audit.eventRefs],
    },
    evidence: {
      bundleRefs: [...state.evidence.bundleRefs],
    },
  };
}

async function writePreparedLocalLaneMarker(statePath: string, laneRunId: string): Promise<void> {
  const markerPath = path.join(statePath, preparedLocalLaneMarkerFilename);
  const marker = `${JSON.stringify(
    {
      schemaVersion: preparedLocalLaneMarkerSchemaVersion,
      laneRunId,
    },
    null,
    2,
  )}\n`;
  const file = await open(
    markerPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | noFollowFlag() | nonBlockingFlag(),
    0o600,
  );

  try {
    const stats = await file.stat();

    if (!stats.isFile()) {
      throw new Error("Local lane preparation marker path must be a regular file.");
    }

    await file.writeFile(marker, "utf8");
  } finally {
    await file.close();
  }
}

function parseLaneRunState(value: unknown): LaneRunState {
  if (!isRecord(value)) {
    throw new Error("Lane run state must be a JSON object.");
  }

  if (value.startsAgentExecution !== false) {
    throw new Error("Lane run state must not start agent execution.");
  }

  if (
    !hasExactKeys(value, [
      "id",
      "workItemId",
      "status",
      "revision",
      "createdAt",
      "updatedAt",
      "startsAgentExecution",
      "journal",
      "audit",
      "evidence",
    ]) ||
    !isLaneRunId(value.id) ||
    !isNonEmptyString(value.workItemId) ||
    !laneRunStatuses.has(value.status) ||
    typeof value.revision !== "number" ||
    !Number.isInteger(value.revision) ||
    value.revision < 1 ||
    !isIsoDateTime(value.createdAt) ||
    !isIsoDateTime(value.updatedAt) ||
    !isLaneJournal(value.journal) ||
    !isAuditRefs(value.audit) ||
    !isEvidenceRefs(value.evidence)
  ) {
    throw new Error("Lane run state is malformed.");
  }

  return value as unknown as LaneRunState;
}

function parseLaneRunQueueRecord(value: unknown): LaneRunQueueRecord {
  if (!isRecord(value)) {
    throw new Error("Lane run queue record must be a JSON object.");
  }

  if (
    value.startsAgentExecution !== false ||
    !hasExactKeys(value, [
      "schemaVersion",
      "id",
      "stableWorkItemId",
      "workItemId",
      "source",
      "laneId",
      "repositoryClassification",
      "status",
      "queuedAt",
      "updatedAt",
      "startsAgentExecution",
      "metadata",
      "publicDiagnostics",
    ]) ||
    value.schemaVersion !== "ensen.lane-run-queue.v1" ||
    !isNonEmptyString(value.id) ||
    !isSafeStableWorkItemId(String(value.stableWorkItemId)) ||
    !isNonEmptyString(value.workItemId) ||
    !isNonEmptyString(value.source) ||
    !laneIdPattern.test(String(value.laneId)) ||
    !isLaneRepositoryClassification(value.repositoryClassification) ||
    !laneRunQueueStatuses.has(value.status) ||
    !isIsoDateTime(value.queuedAt) ||
    !isIsoDateTime(value.updatedAt) ||
    !isStringMetadata(value.metadata) ||
    !isLaneRunQueueDiagnostics(value.publicDiagnostics)
  ) {
    throw new Error("Lane run queue record is malformed.");
  }

  const record = value as unknown as LaneRunQueueRecord;

  if (
    record.publicDiagnostics.stableWorkItemId !== record.stableWorkItemId ||
    record.publicDiagnostics.laneId !== record.laneId ||
    record.publicDiagnostics.source !== record.source ||
    record.publicDiagnostics.repositoryClassification !== record.repositoryClassification ||
    record.publicDiagnostics.status !== record.status
  ) {
    throw new Error("Lane run queue record diagnostics do not match authoritative queue state.");
  }

  return record;
}

function parseLaneRunLock(value: unknown): LaneRunLock {
  if (!isRecord(value)) {
    throw new Error("Lane run lock must be a JSON object.");
  }

  const expectedKeys =
    Object.hasOwn(value, "releasedAt")
      ? [
          "schemaVersion",
          "stableWorkItemId",
          "queueRecordId",
          "laneRunId",
          "laneId",
          "source",
          "repositoryClassification",
          "status",
          "active",
          "claimedAt",
          "claimedBy",
          "releasedAt",
          "startsAgentExecution",
        ]
      : [
          "schemaVersion",
          "stableWorkItemId",
          "queueRecordId",
          "laneRunId",
          "laneId",
          "source",
          "repositoryClassification",
          "status",
          "active",
          "claimedAt",
          "claimedBy",
          "startsAgentExecution",
        ];

  if (
    value.startsAgentExecution !== false ||
    !hasExactKeys(value, expectedKeys) ||
    value.schemaVersion !== "ensen.lane-run-lock.v1" ||
    !isSafeStableWorkItemId(String(value.stableWorkItemId)) ||
    !isNonEmptyString(value.queueRecordId) ||
    !isLaneRunId(value.laneRunId) ||
    !laneIdPattern.test(String(value.laneId)) ||
    !isNonEmptyString(value.source) ||
    !isLaneRepositoryClassification(value.repositoryClassification) ||
    !laneRunLockStatuses.has(value.status) ||
    typeof value.active !== "boolean" ||
    !isIsoDateTime(value.claimedAt) ||
    !isNonEmptyString(value.claimedBy) ||
    (Object.hasOwn(value, "releasedAt") && !isIsoDateTime(value.releasedAt))
  ) {
    throw new Error("Lane run lock is malformed.");
  }

  const lock = value as unknown as LaneRunLock;

  if (
    (lock.status === "active") !== lock.active ||
    (lock.status === "active" && lock.releasedAt !== undefined) ||
    (lock.status !== "active" && lock.releasedAt === undefined)
  ) {
    throw new Error("Lane run lock is malformed.");
  }

  return lock;
}

function parseLaneRunMutationLockOwner(value: unknown): LaneRunMutationLockOwner {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "token", "pid", "acquiredAt"]) ||
    value.schemaVersion !== "ensen.lane-run-mutation-lock-owner.v1" ||
    !isNonEmptyString(value.token) ||
    !Number.isSafeInteger(value.pid) ||
    !isIsoDateTime(value.acquiredAt)
  ) {
    throw new Error("Lane run mutation lock owner is malformed.");
  }

  return value as unknown as LaneRunMutationLockOwner;
}

function toSerializableLaneRunQueueRecord(record: LaneRunQueueRecord): LaneRunQueueRecord {
  return {
    schemaVersion: record.schemaVersion,
    id: record.id,
    stableWorkItemId: record.stableWorkItemId,
    workItemId: record.workItemId,
    source: record.source,
    laneId: record.laneId,
    repositoryClassification: record.repositoryClassification,
    status: record.status,
    queuedAt: record.queuedAt,
    updatedAt: record.updatedAt,
    startsAgentExecution: record.startsAgentExecution,
    metadata: { ...record.metadata },
    publicDiagnostics: {
      stableWorkItemId: record.publicDiagnostics.stableWorkItemId,
      laneId: record.publicDiagnostics.laneId,
      source: record.publicDiagnostics.source,
      repositoryClassification: record.publicDiagnostics.repositoryClassification,
      status: record.publicDiagnostics.status,
    },
  };
}

function toSerializableLaneRunLock(lock: LaneRunLock): LaneRunLock {
  const base = {
    schemaVersion: lock.schemaVersion,
    stableWorkItemId: lock.stableWorkItemId,
    queueRecordId: lock.queueRecordId,
    laneRunId: lock.laneRunId,
    laneId: lock.laneId,
    source: lock.source,
    repositoryClassification: lock.repositoryClassification,
    status: lock.status,
    active: lock.active,
    claimedAt: lock.claimedAt,
    claimedBy: lock.claimedBy,
    startsAgentExecution: lock.startsAgentExecution,
  } satisfies Omit<LaneRunLock, "releasedAt">;

  if (lock.releasedAt === undefined) {
    return base;
  }

  return {
    ...base,
    releasedAt: lock.releasedAt,
  };
}

function isLaneJournal(value: unknown): value is LaneJournal {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["id", "laneRunId", "workItemId", "entries"]) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.laneRunId) &&
    isNonEmptyString(value.workItemId) &&
    Array.isArray(value.entries) &&
    value.entries.every(isLaneJournalEntry)
  );
}

function isLaneJournalEntry(value: unknown): value is LaneJournalEntry {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["id", "recordedAt", "kind", "message"]) &&
    isNonEmptyString(value.id) &&
    isIsoDateTime(value.recordedAt) &&
    ["hypothesis", "command", "failure", "change", "next-action"].includes(String(value.kind)) &&
    isNonEmptyString(value.message)
  );
}

function isAuditRefs(value: unknown): value is LaneAuditRefs {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["eventRefs"]) &&
    Array.isArray(value.eventRefs) &&
    value.eventRefs.every(isNonEmptyString)
  );
}

function isEvidenceRefs(value: unknown): value is LaneEvidenceRefs {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["bundleRefs"]) &&
    Array.isArray(value.bundleRefs) &&
    value.bundleRefs.every(isNonEmptyString)
  );
}

function isLaneRunQueueDiagnostics(value: unknown): value is LaneRunQueueDiagnostics {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "stableWorkItemId",
      "laneId",
      "source",
      "repositoryClassification",
      "status",
    ]) &&
    isSafeStableWorkItemId(String(value.stableWorkItemId)) &&
    laneIdPattern.test(String(value.laneId)) &&
    isNonEmptyString(value.source) &&
    isLaneRepositoryClassification(value.repositoryClassification) &&
    laneRunQueueStatuses.has(value.status)
  );
}

function isLaneRepositoryClassification(value: unknown): value is LaneRepositoryClassification {
  return value === "owner-controlled-dogfood" || value === "customer-repository";
}

function isStringMetadata(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.entries(value).every(([key, metadataValue]) => {
    return (
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(key) &&
      !/secret|token|password|credential/i.test(key) &&
      typeof metadataValue === "string" &&
      metadataValue.length > 0 &&
      metadataValue.length <= 256
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const valueKeys = Object.keys(value);

  return valueKeys.length === expectedKeys.length && expectedKeys.every((key) => Object.hasOwn(value, key));
}

function isLaneRunId(value: unknown): value is string {
  return typeof value === "string" && laneRunIdPattern.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isIsoDateTime(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const match = isoDateTimePattern.exec(value);

  if (!match) {
    return false;
  }

  const [, year, month, day, hour, minute, second, timezone] = match;
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);
  const secondNumber = Number(second);

  if (
    monthNumber < 1 ||
    monthNumber > 12 ||
    dayNumber < 1 ||
    hourNumber > 23 ||
    minuteNumber > 59 ||
    secondNumber > 59
  ) {
    return false;
  }

  if (timezone !== "Z") {
    const timezoneHour = Number(timezone.slice(1, 3));
    const timezoneMinute = Number(timezone.slice(4, 6));

    if (timezoneHour > 23 || timezoneMinute > 59) {
      return false;
    }
  }

  const daysInMonth = new Date(Date.UTC(yearNumber, monthNumber, 0)).getUTCDate();

  return dayNumber <= daysInMonth && Number.isFinite(Date.parse(value));
}

export interface DryRunExecutionPlan {
  readonly command: "dry-run";
  readonly mode: "sample";
  readonly workItem: WorkItem;
  readonly laneWorkspace: {
    readonly intent: string;
    readonly mutatesFilesystem: false;
  };
  readonly agentProvider: {
    readonly intent: string;
    readonly capabilities: typeof AGENT_PROVIDER_CAPABILITIES;
    readonly invokesProvider: false;
  };
  readonly scmProvider: {
    readonly intent: string;
    readonly capabilities: typeof SCM_PROVIDER_CAPABILITIES;
    readonly createsBranch: false;
    readonly opensChangeRequest: false;
  };
  readonly verification: {
    readonly intent: string;
    readonly commands: readonly string[];
  };
  readonly evidence: {
    readonly intent: string;
    readonly writesDurableEvidence: false;
    readonly bundleRefs: readonly EvidenceBundleRef[];
  };
}

export function createSampleDryRunExecutionPlan(): DryRunExecutionPlan {
  return {
    command: "dry-run",
    mode: "sample",
    workItem: sampleLocalWorkItem,
    laneWorkspace: {
      intent: "describe lane workspace preparation without creating a worktree",
      mutatesFilesystem: false,
    },
    agentProvider: {
      intent: "describe agent selection without invoking an agent provider",
      capabilities: AGENT_PROVIDER_CAPABILITIES,
      invokesProvider: false,
    },
    scmProvider: {
      intent: "describe SCM actions without creating branches, commits, or change requests",
      capabilities: SCM_PROVIDER_CAPABILITIES,
      createsBranch: false,
      opensChangeRequest: false,
    },
    verification: {
      intent: "describe repo-owned verification commands without running them",
      commands: ["npm run build", "npm test"],
    },
    evidence: {
      intent:
        "describe validation-ready evidence metadata without writing a full evidence bundle artifact",
      writesDurableEvidence: false,
      bundleRefs: [
        {
          schemaVersion: "eip.evidence-bundle-ref.v1",
          id: "evb_sampleDryRunEvidenceRef01",
          correlationId: "corr_sampleDryRunEvidenceRef01",
          type: "local_path",
          uri: "artifacts/evidence/dry-run/sample-bundle.json",
          createdAt: "2026-04-29T00:00:00Z",
          contentType: "application/json",
          metadata: {
            producer: "ensen-loop",
            artifactKind: "validationReadyEvidenceMetadata",
            writesDurableEvidence: false,
          },
        },
      ],
    },
  };
}
