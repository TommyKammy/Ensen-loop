import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  const statePath = resolveLaneRunStatePath(stateRoot, state.id);

  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${serializeLaneRunState(state)}\n`, "utf8");

  return statePath;
}

export async function readLaneRunState(stateRoot: string, laneRunId: string): Promise<LaneRunState> {
  const statePath = resolveLaneRunStatePath(stateRoot, laneRunId);
  const parsed = JSON.parse(await readFile(statePath, "utf8")) as unknown;

  return parseLaneRunState(parsed);
}

function parseLaneRunState(value: unknown): LaneRunState {
  if (!isRecord(value)) {
    throw new Error("Lane run state must be a JSON object.");
  }

  if (value.startsAgentExecution !== false) {
    throw new Error("Lane run state must not start agent execution.");
  }

  if (
    typeof value.id !== "string" ||
    typeof value.workItemId !== "string" ||
    !laneRunStatuses.has(value.status) ||
    typeof value.revision !== "number" ||
    !Number.isInteger(value.revision) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
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
    typeof value.id === "string" &&
    typeof value.laneRunId === "string" &&
    typeof value.workItemId === "string" &&
    Array.isArray(value.entries) &&
    value.entries.every(isLaneJournalEntry)
  );
}

function isLaneJournalEntry(value: unknown): value is LaneJournalEntry {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.recordedAt === "string" &&
    ["hypothesis", "command", "failure", "change", "next-action"].includes(String(value.kind)) &&
    typeof value.message === "string"
  );
}

function isAuditRefs(value: unknown): value is LaneAuditRefs {
  return isRecord(value) && Array.isArray(value.eventRefs) && value.eventRefs.every(isString);
}

function isEvidenceRefs(value: unknown): value is LaneEvidenceRefs {
  return isRecord(value) && Array.isArray(value.bundleRefs) && value.bundleRefs.every(isString);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
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
