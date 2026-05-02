import type { WorkItem } from "../core/index.js";

export interface GithubOwnerControlledRepository {
  readonly owner: string;
  readonly name: string;
  readonly ownerControlled?: boolean;
}

export interface GithubIssueRepositoryFacts {
  readonly owner?: unknown;
  readonly name?: unknown;
  readonly htmlUrl?: unknown;
}

export interface GithubIssueFacts {
  readonly number?: unknown;
  readonly title?: unknown;
  readonly state?: unknown;
  readonly htmlUrl?: unknown;
}

export interface GithubRequesterFacts {
  readonly login?: unknown;
}

export interface GithubIssuePickupInput {
  readonly allowlist: readonly GithubOwnerControlledRepository[];
  readonly issue: {
    readonly repository: GithubIssueRepositoryFacts;
    readonly issue: GithubIssueFacts;
    readonly requester: GithubRequesterFacts;
  };
}

export interface GithubWorkItemScope {
  readonly provider: "github";
  readonly repository: string;
  readonly issueNumber: number;
  readonly issueUrl: string;
  readonly repositoryUrl: string;
  readonly requester: string;
  readonly ownerControlled: true;
}

export interface GithubPickupBoundary {
  readonly capability: "work-item-pickup";
  readonly readOnly: true;
  readonly mutatesProvider: false;
  readonly startsExecution: false;
  readonly executorCapabilitiesAdvertised: readonly string[];
  readonly protocolRuntimeImported: false;
}

export interface GithubWorkItemPickupIssue {
  readonly path: string;
  readonly message: string;
}

export interface GithubWorkItemPickupSuccess {
  readonly ok: true;
  readonly workItem: WorkItem;
  readonly scope: GithubWorkItemScope;
  readonly boundary: GithubPickupBoundary;
}

export interface GithubWorkItemPickupFailure {
  readonly ok: false;
  readonly issues: readonly GithubWorkItemPickupIssue[];
  readonly boundary: GithubPickupBoundary;
}

export type GithubWorkItemPickupResult =
  | GithubWorkItemPickupSuccess
  | GithubWorkItemPickupFailure;

const githubOwnerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const githubRepositoryPattern = /^[A-Za-z0-9._-]+$/;
const secretLikeTopLevelKeys = new Set(["token", "authorization", "password", "secret"]);

const executorCapabilitiesAdvertised = Object.freeze([] as readonly string[]);

const githubPickupBoundary: GithubPickupBoundary = Object.freeze({
  capability: "work-item-pickup",
  readOnly: true,
  mutatesProvider: false,
  startsExecution: false,
  executorCapabilitiesAdvertised,
  protocolRuntimeImported: false,
});

export function pickupGithubIssueWorkItem(
  input: GithubIssuePickupInput | null | undefined,
): GithubWorkItemPickupResult {
  if (input === null || input === undefined) {
    return {
      ok: false,
      issues: [
        {
          path: "input",
          message: "GitHub pickup input is required.",
        },
      ],
      boundary: githubPickupBoundary,
    };
  }

  const issues = collectGithubIssuePickupIssues(input);

  if (issues.length > 0) {
    return {
      ok: false,
      issues,
      boundary: githubPickupBoundary,
    };
  }

  const repository = input.issue.repository as {
    readonly owner: string;
    readonly name: string;
    readonly htmlUrl: string;
  };
  const issue = input.issue.issue as {
    readonly number: number;
    readonly title: string;
    readonly state: "open" | "closed";
    readonly htmlUrl: string;
  };
  const requester = input.issue.requester as {
    readonly login: string;
  };
  const repositoryName = `${repository.owner}/${repository.name}`;

  return {
    ok: true,
    workItem: {
      id: `github:${repository.owner}/${repository.name}#${issue.number}`,
      title: issue.title,
      source: "github-issue",
      status: issue.state === "open" ? "ready" : "blocked",
    },
    scope: {
      provider: "github",
      repository: repositoryName,
      issueNumber: issue.number,
      issueUrl: issue.htmlUrl,
      repositoryUrl: repository.htmlUrl,
      requester: requester.login,
      ownerControlled: true,
    },
    boundary: githubPickupBoundary,
  };
}

function collectGithubIssuePickupIssues(
  input: GithubIssuePickupInput,
): readonly GithubWorkItemPickupIssue[] {
  const issues: GithubWorkItemPickupIssue[] = [];
  const repository = input.issue?.repository;
  const issue = input.issue?.issue;
  const requester = input.issue?.requester;

  for (const key of Object.keys(input as unknown as Record<string, unknown>)) {
    if (secretLikeTopLevelKeys.has(key.toLowerCase())) {
      issues.push({
        path: key,
        message: "GitHub pickup input must not include credentials or secret-like fields.",
      });
    }
  }

  validateRepositoryFacts(repository, issues);
  validateIssueFacts(repository, issue, issues);
  validateRequesterFacts(requester, issues);
  validateAllowlist(input.allowlist, repository, issues);

  return issues;
}

function validateRepositoryFacts(
  repository: GithubIssueRepositoryFacts | undefined,
  issues: GithubWorkItemPickupIssue[],
): void {
  if (repository === undefined) {
    issues.push({
      path: "repository",
      message: "GitHub repository facts are required.",
    });
    return;
  }

  if (!isGithubOwner(repository.owner)) {
    issues.push({
      path: "repository.owner",
      message: "GitHub repository owner is required and must be a valid owner name.",
    });
  }

  if (!isGithubRepositoryName(repository.name)) {
    issues.push({
      path: "repository.name",
      message: "GitHub repository name is required and must be a valid repository name.",
    });
  }
}

function validateIssueFacts(
  repository: GithubIssueRepositoryFacts | undefined,
  issue: GithubIssueFacts | undefined,
  issues: GithubWorkItemPickupIssue[],
): void {
  if (issue === undefined) {
    issues.push({
      path: "issue",
      message: "GitHub issue facts are required.",
    });
    return;
  }

  if (
    typeof issue.number !== "number" ||
    !Number.isSafeInteger(issue.number) ||
    issue.number <= 0
  ) {
    issues.push({
      path: "issue.number",
      message: "GitHub issue number must be a positive safe integer.",
    });
  }

  if (typeof issue.title !== "string" || issue.title.trim().length === 0) {
    issues.push({
      path: "issue.title",
      message: "GitHub issue title is required and must contain non-whitespace text.",
    });
  }

  if (issue.state !== "open" && issue.state !== "closed") {
    issues.push({
      path: "issue.state",
      message: "GitHub issue state must be open or closed.",
    });
  }

  if (
    typeof issue.htmlUrl !== "string" ||
    (repository !== undefined &&
      typeof issue.number === "number" &&
      Number.isSafeInteger(issue.number) &&
      issue.number > 0 &&
      issue.htmlUrl !== expectedIssueUrl(repository, issue.number))
  ) {
    issues.push({
      path: "issue.htmlUrl",
      message: "GitHub issue URL is required and must match the repository and issue number.",
    });
  }

  if (
    repository !== undefined &&
    repository.htmlUrl !== expectedRepositoryUrl(repository)
  ) {
    issues.push({
      path: "repository.htmlUrl",
      message: "GitHub repository URL is required and must match the repository owner/name.",
    });
  }
}

function validateRequesterFacts(
  requester: GithubRequesterFacts | undefined,
  issues: GithubWorkItemPickupIssue[],
): void {
  if (typeof requester?.login !== "string" || requester.login.trim().length === 0) {
    issues.push({
      path: "requester.login",
      message: "GitHub requester login is required as provenance for later lane submission.",
    });
  }
}

function validateAllowlist(
  allowlist: unknown,
  repository: GithubIssueRepositoryFacts | undefined,
  issues: GithubWorkItemPickupIssue[],
): void {
  if (!Array.isArray(allowlist)) {
    issues.push({
      path: "allowlist",
      message: "Owner-controlled repository allowlist is required and must be an array.",
    });
    return;
  }

  let hasOwnerControlledMatch = false;

  allowlist.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      issues.push({
        path: `allowlist[${index}]`,
        message: "Owner-controlled repository allowlist entries must be objects.",
      });
      return;
    }

    if (entry.ownerControlled !== true) {
      issues.push({
        path: `allowlist[${index}].ownerControlled`,
        message:
          "Owner-controlled repository allowlist entries must explicitly set ownerControlled: true.",
      });
    }

    if (
      repository !== undefined &&
      entry.owner === repository.owner &&
      entry.name === repository.name &&
      entry.ownerControlled === true
    ) {
      hasOwnerControlledMatch = true;
    }
  });

  if (!hasOwnerControlledMatch) {
    issues.push({
      path: "repository",
      message: "GitHub repository must be explicitly allowlisted as owner-controlled.",
    });
  }
}

function expectedRepositoryUrl(repository: GithubIssueRepositoryFacts): string {
  return `https://github.com/${repository.owner}/${repository.name}`;
}

function expectedIssueUrl(repository: GithubIssueRepositoryFacts, issueNumber: number): string {
  return `${expectedRepositoryUrl(repository)}/issues/${issueNumber}`;
}

function isGithubOwner(value: unknown): value is string {
  return typeof value === "string" && githubOwnerPattern.test(value);
}

function isGithubRepositoryName(value: unknown): value is string {
  return typeof value === "string" && githubRepositoryPattern.test(value);
}
