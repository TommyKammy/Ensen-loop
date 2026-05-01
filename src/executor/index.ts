import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  CreateRunResultOptions,
  EvidenceBundleRef,
  RunRequestExecutionPlan,
  RunResult,
  VerificationCommand,
  VerificationSummary,
} from "../protocol/index.js";
import { createRunResult, validateEvidenceBundleRef } from "../protocol/index.js";
import {
  type LaneJournalEntry,
  createLaneJournal,
  createLaneRunState,
  preparedLocalLaneMarkerFilename,
  preparedLocalLaneMarkerSchemaVersion,
  resolveLaneRunStatePath,
  writeLaneRunState,
} from "../lane/index.js";

export type LaneExecutorMode = "deterministic-local-fake";
export type LocalFakeExecutorOutcome = "succeeded" | "failed" | "blocked";

export interface PreparedLaneExecutorContext {
  readonly laneRunId: string;
  readonly workspacePath: string;
  readonly statePath: string;
}

export interface LocalFakeExecutorFixture {
  readonly name: string;
  readonly outcome: LocalFakeExecutorOutcome;
  readonly verificationSummary?: string;
  readonly verificationCommands?: readonly VerificationCommand[];
  readonly blockedReasons?: readonly string[];
}

export interface LaneExecutorInvocationMetadata {
  readonly executorId: string;
  readonly mode: LaneExecutorMode;
  readonly laneRunId: string;
  readonly requestId: string;
  readonly workItemId: string;
  readonly fixtureName: string;
  readonly invokedAt: string;
  readonly invokesProvider: false;
  readonly mutatesScm: false;
}

export interface LaneExecutorResult {
  readonly status: LocalFakeExecutorOutcome;
  readonly invocation: LaneExecutorInvocationMetadata;
  readonly runResult: RunResult;
  readonly blockedReasons: readonly string[];
}

export interface LaneExecutorAdapterInput {
  readonly mode: LaneExecutorMode;
  readonly plan: RunRequestExecutionPlan;
  readonly preparedContext: PreparedLaneExecutorContext;
  readonly completedAt: string;
  readonly fixture: LocalFakeExecutorFixture;
}

export interface LaneExecutorAdapter {
  readonly id: string;
  invoke(input: LaneExecutorAdapterInput): Promise<LaneExecutorResult>;
}

export interface InvokeLaneExecutorInput {
  readonly executor: LaneExecutorAdapter;
  readonly mode: string;
  readonly plan: RunRequestExecutionPlan;
  readonly preparedContext?: PreparedLaneExecutorContext;
  readonly completedAt: string;
  readonly fixture: LocalFakeExecutorFixture;
}

export interface PersistLaneExecutorResultInput {
  readonly stateRoot: string;
  readonly plan: RunRequestExecutionPlan;
  readonly preparedContext: PreparedLaneExecutorContext;
  readonly executorResult: LaneExecutorResult;
  readonly recordedAt: string;
  readonly evidenceBundleRefs?: readonly EvidenceBundleRef[];
}

export interface PersistedLaneExecutorResult {
  readonly state: ReturnType<typeof createLaneRunState>;
  readonly statePath: string;
  readonly evidenceBundleRefs: readonly EvidenceBundleRef[];
  readonly evidenceMetadataPaths: readonly string[];
}

const deterministicLocalFakeMode: LaneExecutorMode = "deterministic-local-fake";
const fixtureNamePattern = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const localLaneIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;
const credentialPattern =
  /(?:password|passwd|token|secret|credential|api[_-]?key)\s*[:=]\s*\S+/i;
const unsafeLocalPathPattern =
  /(?:^|[\s"'([{<>=])(?:\/(?:[^\s"'`<>]*)?|~(?:[/\\]|\s|$)|\$HOME(?:[/\\]|\s|$)|%USERPROFILE%(?:[/\\]|\s|$)|[A-Za-z]:\\[^\s"'`<>]+|\\\\[^\\\s]+\\[^\\\s]+)/i;
const redactedFixtureName = "[REDACTED_FIXTURE]";
const unsupportedExecutorConfigurationReason = "Unsupported executor configuration.";

export function createDeterministicLocalFakeExecutor(): LaneExecutorAdapter {
  return {
    id: deterministicLocalFakeMode,
    async invoke(input) {
      const fixtureIssues = collectFixtureIssues(input.fixture);
      if (fixtureIssues.length > 0) {
        return createBlockedExecutorResult(input, fixtureIssues, true);
      }

      if (input.plan.status === "blocked") {
        return createBlockedExecutorResult(input, input.plan.blockedReasons);
      }

      const status = input.fixture.outcome;
      if (status === "blocked") {
        return createBlockedExecutorResult(
          input,
          input.fixture.blockedReasons?.length
            ? input.fixture.blockedReasons
            : ["deterministic local fake executor fixture requested a blocked outcome"],
        );
      }

      return {
        status,
        invocation: createInvocationMetadata(input),
        runResult: createRunResult(input.plan, {
          status,
          completedAt: input.completedAt,
          verification: createVerificationSummary(input.fixture, status),
        }),
        blockedReasons: [],
      };
    },
  };
}

export async function invokeLaneExecutor(input: InvokeLaneExecutorInput): Promise<LaneExecutorResult> {
  const fixtureIssues = collectFixtureIssues(input.fixture);
  if (fixtureIssues.length > 0) {
    return createBlockedResultWithoutAdapter(input, fixtureIssues, undefined, true);
  }

  if (input.mode !== deterministicLocalFakeMode || input.executor.id !== deterministicLocalFakeMode) {
    return createBlockedResultWithoutAdapter(input, [
      unsupportedExecutorConfigurationReason,
    ]);
  }

  if (input.preparedContext === undefined) {
    return createBlockedResultWithoutAdapter(input, [
      "Prepared lane context is required before executor invocation.",
    ]);
  }

  const contextIssues = await collectPreparedContextIssues(input.preparedContext);
  if (contextIssues.length > 0) {
    return createBlockedResultWithoutAdapter(
      input,
      contextIssues,
      sanitizePreparedContextForBlockedResult(input.preparedContext, input.plan),
    );
  }

  try {
    return await input.executor.invoke({
      mode: deterministicLocalFakeMode,
      plan: input.plan,
      preparedContext: input.preparedContext,
      completedAt: input.completedAt,
      fixture: input.fixture,
    });
  } catch {
    return createBlockedResultWithoutAdapter(
      input,
      ["Executor adapter failed before returning a result."],
      input.preparedContext,
    );
  }
}

export async function persistLaneExecutorResult(
  input: PersistLaneExecutorResultInput,
): Promise<PersistedLaneExecutorResult> {
  assertExecutorResultMatchesPersistenceInput(input);

  const contextIssues = await collectPreparedContextIssues(input.preparedContext);
  if (contextIssues.length > 0) {
    throw new Error(`Prepared lane context is unsafe for persistence: ${contextIssues.join("; ")}`);
  }

  const evidenceBundleRefs = input.evidenceBundleRefs ?? [
    createLocalLaneEvidenceBundleRef(input),
  ];
  const evidenceMetadataPaths = evidenceBundleRefs.map((evidenceBundleRef) =>
    resolveLocalEvidenceMetadataPath(input.preparedContext.statePath, evidenceBundleRef),
  );
  const state = createLaneRunState({
    id: input.preparedContext.laneRunId,
    workItemId: input.plan.workItem.id,
    status: toLaneRunStatus(input.executorResult.status),
    revision: 1,
    createdAt: input.plan.provenance.createdAt,
    updatedAt: input.recordedAt,
    journal: createLaneJournal({
      id: `journal-${input.preparedContext.laneRunId}`,
      laneRunId: input.preparedContext.laneRunId,
      workItemId: input.plan.workItem.id,
      entries: createPersistenceJournalEntries(input),
    }),
    audit: {
      eventRefs: [
        `local-executor:${input.executorResult.invocation.executorId}`,
        `run-result:${input.executorResult.runResult.id}`,
      ],
    },
    evidence: {
      bundleRefs: evidenceBundleRefs.map((evidenceBundleRef) => evidenceBundleRef.uri),
    },
  });

  const writtenEvidencePaths: string[] = [];
  const statePath = resolveLaneRunStatePath(input.stateRoot, state.id);

  try {
    for (const [index, evidenceBundleRef] of evidenceBundleRefs.entries()) {
      const metadataPath = evidenceMetadataPaths[index];
      await assertLocalEvidenceMetadataPathSafe(input.preparedContext.statePath, metadataPath);
      await mkdir(path.dirname(metadataPath), { recursive: true });
      await assertLocalEvidenceMetadataPathSafe(input.preparedContext.statePath, metadataPath);
      await writeFile(
        metadataPath,
        `${JSON.stringify(createEvidenceMetadata(input, evidenceBundleRef), null, 2)}\n`,
        {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        },
      );
      writtenEvidencePaths.push(metadataPath);
    }

    await writeLaneRunState(input.stateRoot, state);

    return {
      state,
      statePath,
      evidenceBundleRefs,
      evidenceMetadataPaths,
    };
  } catch (error) {
    await Promise.all(writtenEvidencePaths.map((metadataPath) => rm(metadataPath, { force: true })));
    await rm(statePath, { force: true });
    throw error;
  }
}

function assertExecutorResultMatchesPersistenceInput(input: PersistLaneExecutorResultInput): void {
  if (input.executorResult.invocation.laneRunId !== input.preparedContext.laneRunId) {
    throw new Error("Executor result lane run identifier does not match the prepared context.");
  }

  if (input.executorResult.invocation.requestId !== input.plan.provenance.requestId) {
    throw new Error("Executor result request identifier does not match the execution plan.");
  }

  if (input.executorResult.invocation.workItemId !== input.plan.workItem.id) {
    throw new Error("Executor result work item identifier does not match the execution plan.");
  }

  if (input.executorResult.runResult.requestId !== input.plan.provenance.requestId) {
    throw new Error("Executor run result request identifier does not match the execution plan.");
  }

  if (input.executorResult.runResult.correlationId !== input.plan.provenance.correlationId) {
    throw new Error("Executor run result correlation identifier does not match the execution plan.");
  }

  if (input.executorResult.runResult.status !== input.executorResult.status) {
    throw new Error("Executor run result status does not match the executor outcome.");
  }
}

async function collectPreparedContextIssues(
  preparedContext: PreparedLaneExecutorContext,
): Promise<readonly string[]> {
  const issues: string[] = [];
  const directoryKinds: Array<"workspace" | "state"> = [];

  if (!localLaneIdPattern.test(preparedContext.laneRunId)) {
    issues.push("Prepared lane context has an invalid lane run identifier.");
  }

  for (const [label, candidatePath] of [
    ["workspace", preparedContext.workspacePath],
    ["state", preparedContext.statePath],
  ] as const) {
    const stats = await lstat(candidatePath).catch((error: unknown) => {
      issues.push(
        isNodeError(error) && error.code === "ENOENT"
          ? `Prepared lane ${label} path must exist before executor invocation.`
          : `Prepared lane ${label} path is not accessible before executor invocation.`,
      );
      return undefined;
    });

    if (stats?.isSymbolicLink()) {
      issues.push(`Prepared lane ${label} path must not be a symbolic link.`);
    } else if (stats && !stats.isDirectory()) {
      issues.push(`Prepared lane ${label} path must be a real directory.`);
    } else if (stats) {
      directoryKinds.push(label);
    }
  }

  if (localLaneIdPattern.test(preparedContext.laneRunId)) {
    for (const directoryKind of directoryKinds) {
      issues.push(...await collectPreparedMarkerIssues(preparedContext, directoryKind));
    }
  }

  return issues;
}

function createLocalLaneEvidenceBundleRef(input: PersistLaneExecutorResultInput): EvidenceBundleRef {
  return {
    schemaVersion: "eip.evidence-bundle-ref.v1",
    id: replaceProtocolIdPrefix(input.preparedContext.laneRunId, "evb"),
    correlationId: input.plan.provenance.correlationId,
    type: "local_path",
    uri: `artifacts/evidence/local-lane/${input.preparedContext.laneRunId}.json`,
    createdAt: input.recordedAt,
    contentType: "application/json",
    metadata: {
      producer: "ensen-loop",
      artifactKind: "localLaneEvidenceMetadata",
      localDevelopmentOnly: true,
      writesDurableEvidence: false,
    },
  };
}

function resolveLocalEvidenceMetadataPath(
  statePath: string,
  evidenceBundleRef: EvidenceBundleRef,
): string {
  const validation = validateEvidenceBundleRef(evidenceBundleRef);

  if (!validation.ok) {
    throw new Error(
      `EvidenceBundleRef output is unsafe: ${validation.issues.map((issue) => issue.message).join("; ")}`,
    );
  }

  if (validation.ref.type !== "local_path") {
    throw new Error("EvidenceBundleRef output is unsafe: persisted local lane evidence must use local_path.");
  }

  const resolvedStatePath = path.resolve(statePath);
  const metadataPath = path.resolve(resolvedStatePath, validation.ref.uri);
  const relativePath = path.relative(resolvedStatePath, metadataPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("EvidenceBundleRef output is unsafe: metadata path escapes the prepared state path.");
  }

  return metadataPath;
}

async function assertLocalEvidenceMetadataPathSafe(
  statePath: string,
  metadataPath: string,
): Promise<void> {
  const realStatePath = await realpath(statePath);
  const metadataDirectory = path.dirname(metadataPath);
  const segments = path.relative(statePath, metadataDirectory).split(path.sep).filter(Boolean);
  let currentPath = statePath;

  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    const stats = await lstat(currentPath).catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }

      throw error;
    });

    if (!stats) {
      return;
    }

    if (stats.isSymbolicLink()) {
      throw new Error("Evidence metadata paths must not traverse symbolic links.");
    }

    if (!stats.isDirectory()) {
      throw new Error("Evidence metadata directory paths must be real directories.");
    }

    const realCurrentPath = await realpath(currentPath);
    const relativePath = path.relative(realStatePath, realCurrentPath);

    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new Error("Evidence metadata paths must stay inside the prepared state path.");
    }
  }

  const metadataStats = await lstat(metadataPath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  });

  if (metadataStats?.isSymbolicLink()) {
    throw new Error("Evidence metadata paths must not traverse symbolic links.");
  }
}

function createEvidenceMetadata(
  input: PersistLaneExecutorResultInput,
  evidenceBundleRef: EvidenceBundleRef,
): Record<string, unknown> {
  return {
    schemaVersion: "ensen.local-lane-evidence-metadata.v1",
    laneRunId: input.preparedContext.laneRunId,
    requestId: input.plan.provenance.requestId,
    workItemId: input.plan.workItem.id,
    outcome: input.executorResult.status,
    recordedAt: input.recordedAt,
    localDevelopmentOnly: true,
    writesProductionEvidenceArchive: false,
    executor: {
      id: input.executorResult.invocation.executorId,
      mode: input.executorResult.invocation.mode,
      fixtureName: input.executorResult.invocation.fixtureName,
      invokesProvider: input.executorResult.invocation.invokesProvider,
      mutatesScm: input.executorResult.invocation.mutatesScm,
    },
    verification: input.executorResult.runResult.verification
      ? {
          status: input.executorResult.runResult.verification.status,
          summary: input.executorResult.runResult.verification.summary,
          commands: input.executorResult.runResult.verification.commands ?? [],
        }
      : undefined,
    blockedReasons: [...input.executorResult.blockedReasons],
    evidenceBundleRef,
  };
}

function createPersistenceJournalEntries(
  input: PersistLaneExecutorResultInput,
): readonly LaneJournalEntry[] {
  const entries: LaneJournalEntry[] = [
    {
      id: `entry-${input.preparedContext.laneRunId}-prepared`,
      recordedAt: input.recordedAt,
      kind: "change",
      message:
        `prepared workspace facts recorded for lane ${input.preparedContext.laneRunId}; ` +
        "workspace and state roots remain local-only and are not embedded",
    },
    {
      id: `entry-${input.preparedContext.laneRunId}-executor`,
      recordedAt: input.executorResult.invocation.invokedAt,
      kind: input.executorResult.status === "failed" ? "failure" : "command",
      message:
        `executor outcome: ${input.executorResult.status}; ` +
        `fixture: ${input.executorResult.invocation.fixtureName}; ` +
        `provider invoked: ${String(input.executorResult.invocation.invokesProvider)}; ` +
        `scm mutated: ${String(input.executorResult.invocation.mutatesScm)}`,
    },
  ];

  if (input.executorResult.blockedReasons.length > 0) {
    entries.push({
      id: `entry-${input.preparedContext.laneRunId}-blocked`,
      recordedAt: input.recordedAt,
      kind: "failure",
      message: `blocked reasons: ${input.executorResult.blockedReasons.join("; ")}`,
    });
  }

  entries.push({
    id: `entry-${input.preparedContext.laneRunId}-next`,
    recordedAt: input.recordedAt,
    kind: "next-action",
    message: createNextActionMessage(input.executorResult.status),
  });

  return entries;
}

function createNextActionMessage(status: LocalFakeExecutorOutcome): string {
  if (status === "succeeded") {
    return "next action: review persisted local lane journal and evidence metadata before publication";
  }

  if (status === "failed") {
    return "next action: inspect failed verification summary and repair before publication";
  }

  return "next action: resolve blocked prerequisites before retrying local lane execution";
}

function toLaneRunStatus(status: LocalFakeExecutorOutcome): "completed" | "failed" | "blocked" {
  if (status === "succeeded") {
    return "completed";
  }

  return status;
}

async function collectPreparedMarkerIssues(
  preparedContext: PreparedLaneExecutorContext,
  directoryKind: "workspace" | "state",
): Promise<readonly string[]> {
  const issues: string[] = [];
  const markerPath = path.join(
    directoryKind === "workspace" ? preparedContext.workspacePath : preparedContext.statePath,
    preparedLocalLaneMarkerFilename,
  );
  const markerNoFollowFlag = noFollowFlag();
  if (markerNoFollowFlag === 0) {
    issues.push(`Prepared lane ${directoryKind} marker cannot be verified without no-follow file open support.`);
    return issues;
  }

  const markerFile = await open(markerPath, constants.O_RDONLY | markerNoFollowFlag).catch((error: unknown) => {
    issues.push(
      isNodeError(error) && error.code === "ENOENT"
        ? `Prepared lane ${directoryKind} marker must exist before executor invocation.`
        : isNodeError(error) && error.code === "ELOOP"
          ? `Prepared lane ${directoryKind} marker must not be a symbolic link.`
          : `Prepared lane ${directoryKind} marker is not accessible before executor invocation.`,
    );
    return undefined;
  });

  if (!markerFile) {
    return issues;
  }

  let rawMarker: string | undefined;

  try {
    const markerStats = await markerFile.stat();

    if (!markerStats.isFile()) {
      issues.push(`Prepared lane ${directoryKind} marker must be a regular file.`);
      return issues;
    }

    rawMarker = await markerFile.readFile("utf8").catch(() => {
      issues.push(`Prepared lane ${directoryKind} marker is not readable before executor invocation.`);
      return undefined;
    });
  } finally {
    await markerFile.close();
  }

  if (rawMarker === undefined) {
    return issues;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawMarker);
  } catch {
    issues.push(`Prepared lane ${directoryKind} marker is malformed.`);
    return issues;
  }

  if (!isPreparedMarkerForLane(parsed, preparedContext.laneRunId)) {
    issues.push(`Prepared lane ${directoryKind} marker does not match the lane run identifier.`);
  }

  return issues;
}

function sanitizePreparedContextForBlockedResult(
  preparedContext: PreparedLaneExecutorContext,
  plan: RunRequestExecutionPlan,
): PreparedLaneExecutorContext {
  if (localLaneIdPattern.test(preparedContext.laneRunId)) {
    return preparedContext;
  }

  return {
    ...preparedContext,
    laneRunId: replaceProtocolIdPrefix(plan.provenance.requestId, "run"),
  };
}

function createBlockedResultWithoutAdapter(
  input: InvokeLaneExecutorInput,
  blockedReasons: readonly string[],
  preparedContext?: PreparedLaneExecutorContext,
  redactFixtureMetadata = false,
): LaneExecutorResult {
  const adapterInput: LaneExecutorAdapterInput = {
    mode: deterministicLocalFakeMode,
    plan: input.plan,
    preparedContext: preparedContext ?? {
      laneRunId: replaceProtocolIdPrefix(input.plan.provenance.requestId, "run"),
      workspacePath: "<blocked-before-workspace-preparation>",
      statePath: "<blocked-before-state-preparation>",
    },
    completedAt: input.completedAt,
    fixture: input.fixture,
  };

  return createBlockedExecutorResult(adapterInput, blockedReasons, redactFixtureMetadata);
}

function createBlockedExecutorResult(
  input: LaneExecutorAdapterInput,
  blockedReasons: readonly string[],
  redactFixtureMetadata = false,
): LaneExecutorResult {
  return {
    status: "blocked",
    invocation: createInvocationMetadata(input, redactFixtureMetadata),
    runResult: createRunResult(
      {
        ...input.plan,
        status: "blocked",
        blockedReasons: [...blockedReasons],
      },
      {
        status: "blocked",
        completedAt: input.completedAt,
        verification: {
          status: "blocked",
          summary: `Deterministic local executor blocked: ${blockedReasons.join("; ")}`,
        },
        warnings: [
          {
            code: "LOCAL_EXECUTOR_BLOCKED",
            message: "The deterministic local executor stopped before provider or SCM work.",
          },
        ],
      },
    ),
    blockedReasons: [...blockedReasons],
  };
}

function createInvocationMetadata(
  input: LaneExecutorAdapterInput,
  redactFixtureMetadata = false,
): LaneExecutorInvocationMetadata {
  return {
    executorId: deterministicLocalFakeMode,
    mode: deterministicLocalFakeMode,
    laneRunId: input.preparedContext.laneRunId,
    requestId: input.plan.provenance.requestId,
    workItemId: input.plan.workItem.id,
    fixtureName: redactFixtureMetadata ? redactedFixtureName : input.fixture.name,
    invokedAt: input.completedAt,
    invokesProvider: false,
    mutatesScm: false,
  };
}

function createVerificationSummary(
  fixture: LocalFakeExecutorFixture,
  status: Exclude<LocalFakeExecutorOutcome, "blocked">,
): VerificationSummary {
  const verificationStatus: NonNullable<CreateRunResultOptions["verification"]> = {
    status: status === "succeeded" ? "passed" : "failed",
    summary:
      fixture.verificationSummary ??
      (status === "succeeded"
        ? "Deterministic local fake executor completed successfully."
        : "Deterministic local fake executor returned a failed outcome."),
    commands: fixture.verificationCommands?.map((command) => ({ ...command })),
  };

  return verificationStatus;
}

function collectFixtureIssues(fixture: LocalFakeExecutorFixture): readonly string[] {
  const issues: string[] = [];

  if (!fixtureNamePattern.test(fixture.name)) {
    issues.push("Deterministic fake executor fixture name is malformed.");
  }

  const fields = [
    fixture.name,
    fixture.verificationSummary,
    ...(fixture.blockedReasons ?? []),
    ...(fixture.verificationCommands ?? []).flatMap((command) => [
      command.command,
      command.summary,
      command.completedAt,
    ]),
  ];

  for (const field of fields) {
    if (field !== undefined && containsUnsafeFixtureText(field)) {
      issues.push("Deterministic fake executor fixture contains unsafe metadata.");
      break;
    }
  }

  return issues;
}

function containsUnsafeFixtureText(value: string): boolean {
  return (
    credentialPattern.test(value) ||
    unsafeLocalPathPattern.test(value)
  );
}

function replaceProtocolIdPrefix(value: string, prefix: string): string {
  const separatorIndex = value.indexOf("_");

  if (separatorIndex < 0) {
    return `${prefix}_${value}`;
  }

  return `${prefix}_${value.slice(separatorIndex + 1)}`;
}

function noFollowFlag(): number {
  return typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
}

function isPreparedMarkerForLane(value: unknown, laneRunId: string): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    value.schemaVersion === preparedLocalLaneMarkerSchemaVersion &&
    value.laneRunId === laneRunId
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
