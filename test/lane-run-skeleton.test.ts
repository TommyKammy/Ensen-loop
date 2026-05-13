import assert from "node:assert/strict";
import { access, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  planBranchLaneRunSkeleton,
  readLaneRunState,
} from "../src/lane/index.js";
import type { WorkItem } from "../src/work-item/index.js";

const readyWorkItem: WorkItem = {
  id: "workitem_01HV7Y8M8F2KQ5W3P9R6T4N258",
  title: "Add worktree and branch lane run skeleton",
  source: "github-issue",
  status: "ready",
};

test("dry-runs a deterministic branch/worktree lane skeleton without filesystem mutation", async () => {
  const roots = await createSkeletonRoots();

  try {
    const skeleton = await planBranchLaneRunSkeleton({
      workItem: readyWorkItem,
      laneRunId: "run_01HV7Y8M8F2KQ5W3P9R6T4N258",
      idempotencyKey: "issue-58-lane-skeleton-001",
      repositoryRoot: roots.repositoryRoot,
      worktreeRoot: roots.worktreeRoot,
      stateRoot: roots.stateRoot,
      branchName: "codex/issue-58",
      authoritativeScope: {
        ownerControlled: true,
        ownerIdentity: "owner-maintainer",
        repositoryId: "repo_01HV7Y8M8F2KQ5W3P9R6T4N2LOOP",
        repositorySlug: "TommyKammy/Ensen-loop",
        repositoryUrl: "https://github.com/TommyKammy/Ensen-loop",
        repositoryRoot: roots.repositoryRoot,
      },
      dogfoodRepositoryAllowlist: dogfoodAllowlist(roots.repositoryRoot),
    });

    assert.equal(skeleton.mode, "dry-run");
    assert.equal(skeleton.mutatesFilesystem, false);
    assert.equal(skeleton.startsAgentExecution, false);
    assert.equal(skeleton.createsBranch, false);
    assert.equal(skeleton.opensChangeRequest, false);
    assert.equal(skeleton.laneRunId, "run_01HV7Y8M8F2KQ5W3P9R6T4N258");
    assert.equal(skeleton.workItem.id, readyWorkItem.id);
    assert.equal(skeleton.branch.name, "codex/issue-58");
    assert.equal(skeleton.worktree.path, path.join(roots.worktreeRoot, "lane-runs", skeleton.laneRunId));
    assert.equal(skeleton.state.stateFile, path.join(roots.stateRoot, "lane-runs", `${skeleton.laneRunId}.json`));
    assert.equal(skeleton.idempotency.key, "issue-58-lane-skeleton-001");
    assert.deepEqual(skeleton.providerState, {
      agentProviderSessionCreated: false,
      scmBranchCreated: false,
      scmWorktreeCreated: false,
      changeRequestCreated: false,
    });

    await assert.rejects(() => access(path.join(roots.worktreeRoot, "lane-runs")), /ENOENT/);
    await assert.rejects(() => access(path.join(roots.stateRoot, "lane-runs")), /ENOENT/);
  } finally {
    await roots.cleanup();
  }
});

test("prepares a local skeleton tied to lane id, branch intent, scope, and restart facts", async () => {
  const roots = await createSkeletonRoots();

  try {
    const skeleton = await planBranchLaneRunSkeleton({
      mode: "prepare",
      workItem: readyWorkItem,
      laneRunId: "run_01HV7Y8M8F2KQ5W3P9R6T4N2RESTART",
      idempotencyKey: "issue-58-lane-skeleton-restart",
      repositoryRoot: roots.repositoryRoot,
      worktreeRoot: roots.worktreeRoot,
      stateRoot: roots.stateRoot,
      branchName: "codex/issue-58-restart",
      baseBranch: "main",
      authoritativeScope: {
        ownerControlled: true,
        ownerIdentity: "owner-maintainer",
        repositoryId: "repo_01HV7Y8M8F2KQ5W3P9R6T4N2LOOP",
        repositorySlug: "TommyKammy/Ensen-loop",
        repositoryUrl: "https://github.com/TommyKammy/Ensen-loop",
        repositoryRoot: roots.repositoryRoot,
      },
      dogfoodRepositoryAllowlist: dogfoodAllowlist(roots.repositoryRoot),
    });

    assert.equal(skeleton.mode, "prepare");
    assert.equal(skeleton.mutatesFilesystem, true);
    assert.equal(skeleton.localSkeleton?.created.workspace, true);
    assert.equal(skeleton.localSkeleton?.created.state, true);
    assert.equal(skeleton.startsAgentExecution, false);
    assert.equal(skeleton.createsBranch, false);
    assert.equal(skeleton.opensChangeRequest, false);

    const state = await readLaneRunState(roots.stateRoot, skeleton.laneRunId);
    assert.equal(state.id, skeleton.laneRunId);
    assert.equal(state.workItemId, readyWorkItem.id);
    assert.equal(state.status, "queued");
    assert.equal(state.startsAgentExecution, false);

    const journalText = state.journal.entries.map((entry) => entry.message).join("\n");
    assert.match(journalText, /branch intent: codex\/issue-58-restart from main/);
    assert.match(journalText, /authoritative scope: TommyKammy\/Ensen-loop repo_01HV7Y8M8F2KQ5W3P9R6T4N2LOOP/);
    assert.match(journalText, /dogfood allowlist matched: TommyKammy\/Ensen-loop ownerIdentity=owner-maintainer/);
    assert.match(journalText, /idempotency key: issue-58-lane-skeleton-restart/);
    assert.match(journalText, /cleanup: remove prepared local lane workspace and state directory for run_01HV7Y8M8F2KQ5W3P9R6T4N2RESTART/);
    assert.equal(JSON.stringify(state).includes(roots.repositoryRoot), false);
    assert.equal(JSON.stringify(state).includes(roots.worktreeRoot), false);

    assert.equal(
      await readFile(path.join(skeleton.localSkeleton!.workspacePath, ".ensen-loop-prepared.json"), "utf8")
        .then((value) => JSON.parse(value).laneRunId),
      skeleton.laneRunId,
    );
  } finally {
    await roots.cleanup();
  }
});

test("requires an owner-controlled dogfood repo allowlist before prepare mutation", async () => {
  const roots = await createSkeletonRoots();
  const allowedScope = {
    ownerControlled: true,
    ownerIdentity: "owner-maintainer",
    repositoryId: "repo_01HV7Y8M8F2KQ5W3P9R6T4N2LOOP",
    repositorySlug: "TommyKammy/Ensen-loop",
    repositoryUrl: "https://github.com/TommyKammy/Ensen-loop",
    repositoryRoot: roots.repositoryRoot,
  } as const;
  const allowlist = [
    {
      ownerControlled: true,
      ownerIdentity: "owner-maintainer",
      repositorySlug: "TommyKammy/Ensen-loop",
      repositoryUrl: "https://github.com/TommyKammy/Ensen-loop",
      repositoryRoot: roots.repositoryRoot,
    },
  ] as const;

  try {
    const dryRun = await planBranchLaneRunSkeleton({
      workItem: readyWorkItem,
      laneRunId: "run_dogfood_allowlisted_dry_run",
      idempotencyKey: "issue-81-dogfood-allow-dryrun",
      repositoryRoot: roots.repositoryRoot,
      worktreeRoot: roots.worktreeRoot,
      stateRoot: roots.stateRoot,
      branchName: "codex/issue-81",
      authoritativeScope: allowedScope,
      dogfoodRepositoryAllowlist: allowlist,
    });

    assert.equal(dryRun.mode, "dry-run");
    assert.equal(dryRun.repository.slug, "TommyKammy/Ensen-loop");
    await assert.rejects(() => access(path.join(roots.worktreeRoot, "lane-runs")), /ENOENT/);
    await assert.rejects(() => access(path.join(roots.stateRoot, "lane-runs")), /ENOENT/);

    const mismatchedAllowlistDryRun = await planBranchLaneRunSkeleton({
      workItem: readyWorkItem,
      laneRunId: "run_dogfood_mismatch_dry_run",
      idempotencyKey: "issue-81-dogfood-mismatch-dryrun",
      repositoryRoot: roots.repositoryRoot,
      worktreeRoot: roots.worktreeRoot,
      stateRoot: roots.stateRoot,
      branchName: "codex/issue-81",
      authoritativeScope: allowedScope,
      dogfoodRepositoryAllowlist: [
        {
          ...allowlist[0],
          ownerIdentity: "different-owner",
        },
      ],
    });

    assert.equal(mismatchedAllowlistDryRun.mode, "dry-run");
    await assert.rejects(() => access(path.join(roots.worktreeRoot, "lane-runs")), /ENOENT/);
    await assert.rejects(() => access(path.join(roots.stateRoot, "lane-runs")), /ENOENT/);

    await assert.rejects(
      () =>
        planBranchLaneRunSkeleton({
          mode: "prepare",
          workItem: readyWorkItem,
          laneRunId: "run_dogfood_missing_allowlist",
          idempotencyKey: "issue-81-dogfood-missing-list",
          repositoryRoot: roots.repositoryRoot,
          worktreeRoot: roots.worktreeRoot,
          stateRoot: roots.stateRoot,
          branchName: "codex/issue-81",
          authoritativeScope: allowedScope,
        }),
      /dogfood repository allowlist is required/,
    );

    await assert.rejects(
      () =>
        planBranchLaneRunSkeleton({
          mode: "prepare",
          workItem: readyWorkItem,
          laneRunId: "run_dogfood_wrong_owner",
          idempotencyKey: "issue-81-dogfood-wrong-owner",
          repositoryRoot: roots.repositoryRoot,
          worktreeRoot: roots.worktreeRoot,
          stateRoot: roots.stateRoot,
          branchName: "codex/issue-81",
          authoritativeScope: {
            ...allowedScope,
            ownerIdentity: "flow-approval",
          },
          dogfoodRepositoryAllowlist: allowlist,
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /ownerIdentity/);
        assert.doesNotMatch(error.message, new RegExp(escapeRegExp(roots.repositoryRoot)));
        assert.doesNotMatch(error.message, new RegExp(escapeRegExp(roots.worktreeRoot)));
        assert.doesNotMatch(error.message, new RegExp(escapeRegExp(roots.stateRoot)));
        return true;
      },
    );

    await assert.rejects(() => access(path.join(roots.worktreeRoot, "lane-runs")), /ENOENT/);
    await assert.rejects(() => access(path.join(roots.stateRoot, "lane-runs")), /ENOENT/);
  } finally {
    await roots.cleanup();
  }
});

test("allows adapter-agnostic https repository URLs for prepare allowlist matching", async () => {
  const roots = await createSkeletonRoots();
  const repositoryUrl = "https://github.enterprise.example/scm/TommyKammy/Ensen-loop";

  try {
    const skeleton = await planBranchLaneRunSkeleton({
      mode: "prepare",
      workItem: readyWorkItem,
      laneRunId: "run_dogfood_enterprise_url",
      idempotencyKey: "issue-81-dogfood-enterprise-url",
      repositoryRoot: roots.repositoryRoot,
      worktreeRoot: roots.worktreeRoot,
      stateRoot: roots.stateRoot,
      branchName: "codex/issue-81-enterprise-url",
      authoritativeScope: {
        ownerControlled: true,
        ownerIdentity: "owner-maintainer",
        repositoryId: "repo_01HV7Y8M8F2KQ5W3P9R6T4N2LOOP",
        repositorySlug: "TommyKammy/Ensen-loop",
        repositoryUrl,
        repositoryRoot: roots.repositoryRoot,
      },
      dogfoodRepositoryAllowlist: [
        {
          ownerControlled: true,
          ownerIdentity: "owner-maintainer",
          repositorySlug: "TommyKammy/Ensen-loop",
          repositoryUrl,
          repositoryRoot: roots.repositoryRoot,
        },
      ],
    });

    assert.equal(skeleton.mode, "prepare");
    assert.equal(skeleton.repository.url, repositoryUrl);
  } finally {
    await roots.cleanup();
  }
});

test("requires explicit customer repo allowlist policy without leaking customer details", async () => {
  const roots = await createSkeletonRoots();
  const customerRoot = path.join(path.dirname(roots.repositoryRoot), "customer-repo");
  const customerRepositoryId = "allowed-owner-allowed-repo-customer-root-identifier";
  const customerScope = {
    repositoryClassification: "customer-repository",
    repositoryId: customerRepositoryId,
    repositorySlug: "allowed-owner/allowed-repo",
    repositoryUrl: "https://scm.invalid/allowed-owner/allowed-repo",
    repositoryRoot: customerRoot,
    customerRepositoryPurpose: "authorized bounded local preparation",
    customerApprovalNote: "approval note recorded for bounded local preparation",
  } as const;

  try {
    await mkdir(customerRoot);

    const skeleton = await planBranchLaneRunSkeleton({
      mode: "prepare",
      workItem: readyWorkItem,
      laneRunId: "run_customer_allowlisted",
      idempotencyKey: "issue-97-customer-allowlisted",
      repositoryRoot: customerRoot,
      worktreeRoot: roots.worktreeRoot,
      stateRoot: roots.stateRoot,
      branchName: "codex/issue-97-customer",
      authoritativeScope: customerScope,
      customerRepositoryAllowlist: [
        {
          repositoryClassification: "customer-repository",
          owner: "allowed-owner",
          repo: "allowed-repo",
          repositoryRoot: customerRoot,
          purpose: "authorized bounded local preparation",
          approvalNote: "approval note recorded for bounded local preparation",
        },
      ],
    });

    assert.equal(skeleton.repository.classification, "customer-repository");
    assert.equal(skeleton.repository.id, "<customer-repository>");
    assert.equal(skeleton.repository.slug, "<customer-repository>");
    assert.equal(skeleton.repository.url, undefined);

    const serializedSkeleton = JSON.stringify(skeleton);
    assert.doesNotMatch(serializedSkeleton, new RegExp(escapeRegExp(customerRepositoryId)));
    assert.doesNotMatch(serializedSkeleton, /allowed-owner/);
    assert.doesNotMatch(serializedSkeleton, /allowed-repo/);
    assert.doesNotMatch(serializedSkeleton, /scm\.invalid/);
    assert.doesNotMatch(serializedSkeleton, /authorized bounded local preparation/);
    assert.doesNotMatch(serializedSkeleton, new RegExp(escapeRegExp(customerRoot)));

    const state = await readLaneRunState(roots.stateRoot, skeleton.laneRunId);
    const serializedState = JSON.stringify(state);
    assert.match(serializedState, /customer repo allowlist matched/);
    assert.doesNotMatch(serializedState, new RegExp(escapeRegExp(customerRepositoryId)));
    assert.doesNotMatch(serializedState, /allowed-owner/);
    assert.doesNotMatch(serializedState, /allowed-repo/);
    assert.doesNotMatch(serializedState, /scm\.invalid/);
    assert.doesNotMatch(serializedState, /authorized bounded local preparation/);
    assert.doesNotMatch(serializedState, new RegExp(escapeRegExp(customerRoot)));

    await assert.rejects(
      () =>
        planBranchLaneRunSkeleton({
          mode: "prepare",
          workItem: readyWorkItem,
          laneRunId: "run_customer_missing_allowlist",
          idempotencyKey: "issue-97-customer-missing-list",
          repositoryRoot: customerRoot,
          worktreeRoot: roots.worktreeRoot,
          stateRoot: roots.stateRoot,
          branchName: "codex/issue-97-customer-missing",
          authoritativeScope: customerScope,
        }),
      /Customer repository allowlist is required/,
    );

    await assert.rejects(
      () =>
        planBranchLaneRunSkeleton({
          mode: "prepare",
          workItem: readyWorkItem,
          laneRunId: "run_customer_wrong_purpose",
          idempotencyKey: "issue-97-customer-wrong-purpose",
          repositoryRoot: customerRoot,
          worktreeRoot: roots.worktreeRoot,
          stateRoot: roots.stateRoot,
          branchName: "codex/issue-97-customer-wrong-purpose",
          authoritativeScope: customerScope,
          customerRepositoryAllowlist: [
            {
              repositoryClassification: "customer-repository",
              owner: "allowed-owner",
              repo: "allowed-repo",
              repositoryRoot: customerRoot,
              purpose: "different bounded local preparation",
              approvalNote: "approval note recorded for bounded local preparation",
            },
          ],
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /owner, repo, repositoryRoot, purpose, or approvalNote/);
        assert.doesNotMatch(error.message, /allowed-owner/);
        assert.doesNotMatch(error.message, /allowed-repo/);
        assert.doesNotMatch(error.message, /different bounded local preparation/);
        assert.doesNotMatch(error.message, new RegExp(escapeRegExp(customerRoot)));
        return true;
      },
    );

    await assert.rejects(() => access(path.join(roots.worktreeRoot, "lane-runs", "run_customer_missing_allowlist")), /ENOENT/);
    await assert.rejects(() => access(path.join(roots.stateRoot, "lane-runs", "run_customer_missing_allowlist")), /ENOENT/);
    await assert.rejects(() => access(path.join(roots.worktreeRoot, "lane-runs", "run_customer_wrong_purpose")), /ENOENT/);
    await assert.rejects(() => access(path.join(roots.stateRoot, "lane-runs", "run_customer_wrong_purpose")), /ENOENT/);
  } finally {
    await roots.cleanup();
  }
});

test("rejects unsupported repository classifications before policy selection", async () => {
  const roots = await createSkeletonRoots();

  try {
    await assert.rejects(
      () =>
        planBranchLaneRunSkeleton({
          mode: "prepare",
          workItem: readyWorkItem,
          laneRunId: "run_unknown_repository_classification",
          idempotencyKey: "issue-97-unknown-repository-classification",
          repositoryRoot: roots.repositoryRoot,
          worktreeRoot: roots.worktreeRoot,
          stateRoot: roots.stateRoot,
          branchName: "codex/issue-97-unknown-classification",
          authoritativeScope: {
            repositoryClassification: "partner-repository" as never,
            ownerControlled: true,
            ownerIdentity: "owner-maintainer",
            repositoryId: "repo_01HV7Y8M8F2KQ5W3P9R6T4N2LOOP",
            repositorySlug: "TommyKammy/Ensen-loop",
            repositoryUrl: "https://github.com/TommyKammy/Ensen-loop",
            repositoryRoot: roots.repositoryRoot,
          },
          dogfoodRepositoryAllowlist: dogfoodAllowlist(roots.repositoryRoot),
        }),
      /repository classification is unsupported/,
    );

    await assert.rejects(
      () => access(path.join(roots.worktreeRoot, "lane-runs", "run_unknown_repository_classification")),
      /ENOENT/,
    );
    await assert.rejects(
      () => access(path.join(roots.stateRoot, "lane-runs", "run_unknown_repository_classification")),
      /ENOENT/,
    );
  } finally {
    await roots.cleanup();
  }
});

test("fails closed before mutation for unsafe branch, missing scope, symlink root, and disallowed repository", async () => {
  const roots = await createSkeletonRoots();
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-outside-repo-"));
  const symlinkRoot = path.join(outsideRoot, "repo-symlink");

  try {
    await symlink(roots.repositoryRoot, symlinkRoot, "dir");

    await assert.rejects(
      () =>
        planBranchLaneRunSkeleton({
          mode: "prepare",
          workItem: readyWorkItem,
          laneRunId: "run_unsafe_branch",
          idempotencyKey: "issue-58-lane-skeleton-unsafe",
          repositoryRoot: roots.repositoryRoot,
          worktreeRoot: roots.worktreeRoot,
          stateRoot: roots.stateRoot,
          branchName: "../escape",
          authoritativeScope: {
            ownerControlled: true,
            repositoryId: "repo_allowed",
            repositorySlug: "TommyKammy/Ensen-loop",
            repositoryRoot: roots.repositoryRoot,
          },
        }),
      /Branch name is unsafe/,
    );
    await assert.rejects(() => access(path.join(roots.worktreeRoot, "lane-runs")), /ENOENT/);

    await assert.rejects(
      () =>
        planBranchLaneRunSkeleton({
          mode: "prepare",
          workItem: readyWorkItem,
          laneRunId: "run_missing_scope",
          idempotencyKey: "issue-58-lane-skeleton-missing-scope",
          repositoryRoot: roots.repositoryRoot,
          worktreeRoot: roots.worktreeRoot,
          stateRoot: roots.stateRoot,
          branchName: "codex/issue-58",
        }),
      /authoritative repository scope is required/,
    );

    await assert.rejects(
      () =>
        planBranchLaneRunSkeleton({
          mode: "prepare",
          workItem: readyWorkItem,
          laneRunId: "run_symlink_root",
          idempotencyKey: "issue-58-lane-skeleton-symlink-root",
          repositoryRoot: symlinkRoot,
          worktreeRoot: roots.worktreeRoot,
          stateRoot: roots.stateRoot,
          branchName: "codex/issue-58",
          authoritativeScope: {
            ownerControlled: true,
            repositoryId: "repo_allowed",
            repositorySlug: "TommyKammy/Ensen-loop",
            repositoryRoot: symlinkRoot,
          },
        }),
      /Repository root must be a real directory/,
    );

    await assert.rejects(
      () =>
        planBranchLaneRunSkeleton({
          mode: "prepare",
          workItem: readyWorkItem,
          laneRunId: "run_disallowed_repo",
          idempotencyKey: "issue-58-lane-skeleton-disallowed",
          repositoryRoot: outsideRoot,
          worktreeRoot: roots.worktreeRoot,
          stateRoot: roots.stateRoot,
          branchName: "codex/issue-58",
          allowedRepositoryRoots: [roots.repositoryRoot],
          authoritativeScope: {
            ownerControlled: true,
            repositoryId: "repo_disallowed",
            repositorySlug: "TommyKammy/Other",
            repositoryRoot: outsideRoot,
          },
        }),
      /Repository root is not allowlisted/,
    );

    await assert.rejects(() => access(path.join(roots.worktreeRoot, "lane-runs")), /ENOENT/);
    await assert.rejects(() => access(path.join(roots.stateRoot, "lane-runs")), /ENOENT/);
  } finally {
    await roots.cleanup();
    await rm(outsideRoot, { recursive: true, force: true });
    await rm(symlinkRoot, { force: true });
  }
});

test("preserves pre-existing local skeleton directories when state persistence fails", async () => {
  const roots = await createSkeletonRoots();
  const laneRunId = "run_existing_local_skeleton";
  const existingWorkspacePath = path.join(roots.worktreeRoot, "lane-runs", laneRunId);
  const existingStatePath = path.join(roots.stateRoot, "lane-runs", laneRunId);
  const blockedStateFilePath = path.join(roots.stateRoot, "lane-runs", `${laneRunId}.json`);

  try {
    await mkdir(existingWorkspacePath, { recursive: true });
    await mkdir(existingStatePath, { recursive: true });
    await mkdir(blockedStateFilePath, { recursive: true });
    await writeFile(path.join(existingWorkspacePath, "pre-existing.txt"), "keep workspace\n", "utf8");
    await writeFile(path.join(existingStatePath, "pre-existing.txt"), "keep state\n", "utf8");

    await assert.rejects(
      () =>
        planBranchLaneRunSkeleton({
          mode: "prepare",
          workItem: readyWorkItem,
          laneRunId,
          idempotencyKey: "issue-58-lane-skeleton-existing-fail",
          repositoryRoot: roots.repositoryRoot,
          worktreeRoot: roots.worktreeRoot,
          stateRoot: roots.stateRoot,
          branchName: "codex/issue-58-existing-fail",
          authoritativeScope: {
            ownerControlled: true,
            ownerIdentity: "owner-maintainer",
            repositoryId: "repo_01HV7Y8M8F2KQ5W3P9R6T4N2LOOP",
            repositorySlug: "TommyKammy/Ensen-loop",
            repositoryUrl: "https://github.com/TommyKammy/Ensen-loop",
            repositoryRoot: roots.repositoryRoot,
          },
          dogfoodRepositoryAllowlist: dogfoodAllowlist(roots.repositoryRoot),
        }),
      /Lane run state file path must be a regular file/,
    );

    assert.equal((await lstat(existingWorkspacePath)).isDirectory(), true);
    assert.equal((await lstat(existingStatePath)).isDirectory(), true);
    assert.equal(await readFile(path.join(existingWorkspacePath, "pre-existing.txt"), "utf8"), "keep workspace\n");
    assert.equal(await readFile(path.join(existingStatePath, "pre-existing.txt"), "utf8"), "keep state\n");
  } finally {
    await roots.cleanup();
  }
});

async function createSkeletonRoots(): Promise<{
  readonly repositoryRoot: string;
  readonly worktreeRoot: string;
  readonly stateRoot: string;
  readonly cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ensen-loop-skeleton-"));
  const repositoryRoot = path.join(root, "repo");
  const worktreeRoot = path.join(root, "worktrees");
  const stateRoot = path.join(root, "state");

  await mkdir(repositoryRoot);
  await mkdir(worktreeRoot);
  await mkdir(stateRoot);

  return {
    repositoryRoot,
    worktreeRoot,
    stateRoot,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

function dogfoodAllowlist(repositoryRoot: string) {
  return [
    {
      ownerControlled: true,
      ownerIdentity: "owner-maintainer",
      repositorySlug: "TommyKammy/Ensen-loop",
      repositoryUrl: "https://github.com/TommyKammy/Ensen-loop",
      repositoryRoot,
    },
  ] as const;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
