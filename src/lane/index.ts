import type { WorkItem } from "../core/index.js";
import { sampleLocalWorkItem } from "../work-item/index.js";

export type { DurableState, LaneJournal, LaneRun } from "../core/index.js";

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
