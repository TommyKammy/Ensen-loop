import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { lstat, mkdir, open, realpath, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

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

export interface AuthoritativeLaneRunScope {
  readonly ownerControlled: true;
  readonly repositoryId: string;
  readonly repositorySlug: string;
  readonly repositoryRoot: string;
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
    readonly id: string;
    readonly slug: string;
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
const branchNamePattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/;
const repositorySlugPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const idempotencyIntentPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{11,159}$/;
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

  const repositoryRoot = await resolveCanonicalRepositoryRoot(input.repositoryRoot);
  const scopedRepositoryRoot = await resolveCanonicalRepositoryRoot(scope.repositoryRoot);

  if (repositoryRoot.realPath !== scopedRepositoryRoot.realPath) {
    throw new Error("Repository root must match the authoritative repository scope.");
  }

  if (input.allowedRepositoryRoots !== undefined) {
    await assertRepositoryRootAllowlisted(repositoryRoot.realPath, input.allowedRepositoryRoots);
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
    repository: {
      id: scope.repositoryId,
      slug: scope.repositorySlug,
    },
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
        {
          id: `${laneRunId}-scope`,
          recordedAt,
          kind: "hypothesis",
          message: `authoritative scope: ${scope.repositorySlug} ${scope.repositoryId}`,
        },
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
    await rm(localSkeleton.workspacePath, { recursive: true, force: true });
    await rm(localSkeleton.statePath, { recursive: true, force: true });
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
  if (
    scope.ownerControlled !== true ||
    !isNonEmptyString(scope.repositoryId) ||
    !repositorySlugPattern.test(scope.repositorySlug) ||
    !isNonEmptyString(scope.repositoryRoot)
  ) {
    throw new Error("Authoritative repository scope is malformed.");
  }
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
