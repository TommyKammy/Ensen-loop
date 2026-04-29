import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import path from "node:path";

import type { LaneAuditRefs } from "../audit/index.js";
import type { WorkItem } from "../core/index.js";
import type { LaneEvidenceRefs } from "../evidence/index.js";
import { sampleLocalWorkItem } from "../work-item/index.js";

export type LaneRunStatus =
  | "queued"
  | "running"
  | "verifying"
  | "reviewing"
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

const laneRunIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const isoDateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const laneRunStatuses = new Set<unknown>([
  "queued",
  "running",
  "verifying",
  "reviewing",
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

export function serializeLaneRunState(state: LaneRunState): string {
  return JSON.stringify(state, null, 2);
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

  await assertLaneRunStatePathSafeForWrite(stateRoot, statePath);
  await mkdir(path.dirname(statePath), { recursive: true });
  await assertLaneRunStatePathSafeForWrite(stateRoot, statePath);

  const file = await open(
    statePath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | noFollowFlag(),
    0o600,
  );

  try {
    await file.writeFile(`${serializeLaneRunState(validatedState)}\n`, "utf8");
  } finally {
    await file.close();
  }

  return statePath;
}

export async function readLaneRunState(stateRoot: string, laneRunId: string): Promise<LaneRunState> {
  const statePath = resolveLaneRunStatePath(stateRoot, laneRunId);
  await assertLaneRunStatePathSafeForRead(stateRoot, statePath);

  const file = await open(statePath, constants.O_RDONLY | noFollowFlag());
  let contents: string;

  try {
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

async function assertLaneRunStatePathSafeForWrite(stateRoot: string, statePath: string): Promise<void> {
  const realRoot = await resolveCanonicalStateRoot(stateRoot);
  const laneRunsRoot = path.join(path.resolve(stateRoot), "lane-runs");

  await assertExistingPathSafe(realRoot, laneRunsRoot, "directory");
  await assertExistingPathSafe(realRoot, statePath, "file");
}

async function assertLaneRunStatePathSafeForRead(stateRoot: string, statePath: string): Promise<void> {
  const realRoot = await resolveCanonicalStateRoot(stateRoot);
  const laneRunsRoot = path.join(path.resolve(stateRoot), "lane-runs");

  await assertExistingPathSafe(realRoot, laneRunsRoot, "directory");
  await assertExistingPathSafe(realRoot, statePath, "file");
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

  if (expectedKind === "file" && stats.isDirectory()) {
    throw new Error("Lane run state file path must not be a directory.");
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
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
    readonly invokesProvider: false;
  };
  readonly scmProvider: {
    readonly intent: string;
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
      invokesProvider: false,
    },
    scmProvider: {
      intent: "describe SCM actions without creating branches, commits, or change requests",
      createsBranch: false,
      opensChangeRequest: false,
    },
    verification: {
      intent: "describe repo-owned verification commands without running them",
      commands: ["npm run build", "npm test"],
    },
    evidence: {
      intent: "describe evidence capture without writing durable evidence",
      writesDurableEvidence: false,
    },
  };
}
