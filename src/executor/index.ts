import { lstat } from "node:fs/promises";

import type {
  CreateRunResultOptions,
  RunRequestExecutionPlan,
  RunResult,
  VerificationCommand,
  VerificationSummary,
} from "../protocol/index.js";
import { createRunResult } from "../protocol/index.js";

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

  return input.executor.invoke({
    mode: deterministicLocalFakeMode,
    plan: input.plan,
    preparedContext: input.preparedContext,
    completedAt: input.completedAt,
    fixture: input.fixture,
  });
}

async function collectPreparedContextIssues(
  preparedContext: PreparedLaneExecutorContext,
): Promise<readonly string[]> {
  const issues: string[] = [];

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
    }
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
