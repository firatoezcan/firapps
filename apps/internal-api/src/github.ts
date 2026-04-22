import { Buffer } from "node:buffer";

import { internalApiEnv } from "./config.js";

export class GitHubIntegrationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type GitHubRepository = {
  defaultBranch: string;
  fullName: string;
  htmlUrl: string;
  name: string;
  ownerLogin: string;
};

type GitHubRepositoryRegistrationValidation = {
  defaultBranch: string;
  fullName: string;
  htmlUrl: string;
  repoName: string;
  repoOwner: string;
};

type GitHubPullRequestResult = {
  branchName: string;
  commitSha: string;
  filePath: string;
  prNumber: number;
  prUrl: string;
};

export type GitHubPullRequestMetadata = {
  additions: number | null;
  authorLogin: string | null;
  baseBranch: string | null;
  checksStatus: string | null;
  commitCount: number | null;
  commentCount: number | null;
  createdAt: string | null;
  deletions: number | null;
  githubState: string | null;
  githubUpdatedAt: string | null;
  headBranch: string | null;
  headSha: string | null;
  labels: string[];
  isDraft: boolean | null;
  lineChangeCount: number | null;
  mergeable: boolean | null;
  mergeableState: string | null;
  metadataError: string | null;
  prTitle: string | null;
  prNumber: number | null;
  repoName: string | null;
  repoOwner: string | null;
  requestedReviewerCount: number | null;
  requestedReviewerLogins: string[];
  reviewCommentCount: number | null;
  changedFiles: number | null;
};

type RunPullRequestInput = {
  branchName?: string | null;
  defaultBranch?: string | null;
  objective: string;
  organizationName?: string | null;
  publishedBranchName?: string | null;
  publishedCommitSha?: string | null;
  projectName: string;
  repoName: string;
  repoOwner: string;
  runId: string;
  runTitle: string;
  requestedByEmail?: string | null;
  requestedByName?: string | null;
  reportMarkdown?: string | null;
  summary: string;
  workspacePushFailureReason?: string | null;
};

function requireGitHubToken() {
  if (!internalApiEnv.GITHUB_TOKEN) {
    throw new GitHubIntegrationError("github_token_not_configured", 503);
  }

  return internalApiEnv.GITHUB_TOKEN;
}

function buildApiUrl(path: string) {
  const base = internalApiEnv.GITHUB_API_BASE_URL.endsWith("/")
    ? internalApiEnv.GITHUB_API_BASE_URL
    : `${internalApiEnv.GITHUB_API_BASE_URL}/`;

  return new URL(path.replace(/^\//, ""), base);
}

function parsePullRequestUrl(prUrl: string) {
  try {
    const url = new URL(prUrl);

    if (url.hostname !== "github.com") {
      return null;
    }

    const parts = url.pathname.replace(/^\/+/, "").split("/");

    if (parts.length < 4 || parts[2] !== "pull") {
      return null;
    }

    const prNumber = Number(parts[3]);

    if (!Number.isInteger(prNumber) || prNumber < 1) {
      return null;
    }

    return {
      prNumber,
      repoName: parts[1] ?? null,
      repoOwner: parts[0] ?? null,
    };
  } catch {
    return null;
  }
}

async function readFailure(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as {
      errors?: Array<{ message?: string }>;
      message?: string;
    };

    const extra = payload.errors
      ?.map((entry) => entry.message)
      .filter(Boolean)
      .join("; ");

    return {
      details: payload,
      message: extra
        ? `${payload.message ?? "github_request_failed"}: ${extra}`
        : (payload.message ?? "github_request_failed"),
    };
  }

  const payload = (await response.text()).trim();

  return {
    details: payload,
    message: payload || "github_request_failed",
  };
}

async function githubRequest<TOutput>(
  path: string,
  init: RequestInit,
  parse: (response: Response) => Promise<TOutput>,
): Promise<TOutput> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/vnd.github+json");
  headers.set("authorization", `Bearer ${requireGitHubToken()}`);
  headers.set("x-github-api-version", "2022-11-28");

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(buildApiUrl(path), {
    ...init,
    headers,
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const failure = await readFailure(response);

    throw new GitHubIntegrationError(failure.message, response.status, failure.details);
  }

  return parse(response);
}

async function githubJson<TOutput>(path: string, init: RequestInit = {}) {
  return githubRequest(path, init, async (response) => (await response.json()) as TOutput);
}

async function githubNoContent(path: string, init: RequestInit = {}) {
  return githubRequest(path, init, async () => undefined);
}

async function readBranchHeadSha(repoOwner: string, repoName: string, branchName: string) {
  const reference = await githubJson<{ object?: { sha?: string } }>(
    `/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/git/ref/heads/${encodeURIComponent(
      branchName,
    )}`,
  );
  const sha = reference.object?.sha;

  if (!sha) {
    throw new GitHubIntegrationError("github_branch_sha_missing", 502, reference);
  }

  return sha;
}

export function buildRunBranchName(runId: string, explicitBranchName?: string | null) {
  if (explicitBranchName?.trim()) {
    return explicitBranchName.trim();
  }

  return `firapps/devboxes-local/${runId}`;
}

function buildRunReportPath(runId: string) {
  return `.firapps/runs/${runId}.md`;
}

function buildRunCommitMessage(input: RunPullRequestInput) {
  return `firapps: add run report for ${input.runTitle}`;
}

function buildRunPullRequestTitle(input: RunPullRequestInput) {
  return `firapps MVP run: ${input.runTitle}`;
}

function buildRunReportMarkdown(input: RunPullRequestInput) {
  const lines = [
    "# firapps MVP run report",
    "",
    `- Run ID: \`${input.runId}\``,
    `- Project: ${input.projectName}`,
    `- Repository: ${input.repoOwner}/${input.repoName}`,
    input.organizationName ? `- Organization: ${input.organizationName}` : null,
    input.requestedByName || input.requestedByEmail
      ? `- Requested by: ${input.requestedByName ?? input.requestedByEmail}${
          input.requestedByName && input.requestedByEmail ? ` <${input.requestedByEmail}>` : ""
        }`
      : null,
    "",
    "## Objective",
    "",
    input.objective,
    "",
    "## Result summary",
    "",
    input.summary,
    "",
    "## Notes",
    "",
    "- This branch and PR were created by the local-first firapps MVP happy path.",
    "- The run report file reflects the deterministic execution artifact captured from the isolated devbox runtime.",
    "",
  ];

  return lines.filter((line): line is string => line != null).join("\n");
}

function buildRunPullRequestBody(input: RunPullRequestInput) {
  const branchPublicationNote = input.publishedBranchName
    ? `The branch contents were pushed from the isolated devbox runtime on \`${input.publishedBranchName}\`.`
    : "The branch currently contains the execution report artifact captured from the isolated devbox runtime under `.firapps/runs/`.";
  const fallbackNote = input.workspacePushFailureReason
    ? `Workspace branch publication fell back to the GitHub report-commit path because: ${input.workspacePushFailureReason}`
    : null;

  return [
    "## firapps local-first SaaS MVP",
    "",
    "This draft PR was opened automatically from a dispatched run.",
    "",
    `- Run ID: \`${input.runId}\``,
    `- Project: ${input.projectName}`,
    `- Objective: ${input.objective}`,
    "",
    branchPublicationNote,
    ...(fallbackNote ? ["", fallbackNote] : []),
  ].join("\n");
}

async function getRepository(repoOwner: string, repoName: string): Promise<GitHubRepository> {
  const payload = await githubJson<{
    default_branch: string;
    full_name: string;
    html_url: string;
    name: string;
    owner?: { login?: string };
  }>(`/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}`);

  return {
    defaultBranch: payload.default_branch,
    fullName: payload.full_name,
    htmlUrl: payload.html_url,
    name: payload.name,
    ownerLogin: payload.owner?.login ?? repoOwner,
  };
}

async function ensureRepositoryBranch(repoOwner: string, repoName: string, branchName: string) {
  await githubJson<{ name?: string }>(
    `/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/branches/${encodeURIComponent(
      branchName,
    )}`,
  );
}

export async function validateGitHubRepositoryRegistration(input: {
  defaultBranch?: string | null;
  repoName: string;
  repoOwner: string;
  repoProvider: string;
}): Promise<GitHubRepositoryRegistrationValidation> {
  if (input.repoProvider !== "github") {
    throw new GitHubIntegrationError("github_repository_registration_requires_github", 422, {
      repoProvider: input.repoProvider,
    });
  }

  const repository = await getRepository(input.repoOwner, input.repoName);
  const requestedBranch = input.defaultBranch?.trim() || null;
  const defaultBranch = requestedBranch || repository.defaultBranch;

  if (requestedBranch) {
    await ensureRepositoryBranch(repository.ownerLogin, repository.name, requestedBranch);
  }

  return {
    defaultBranch,
    fullName: repository.fullName,
    htmlUrl: repository.htmlUrl,
    repoName: repository.name,
    repoOwner: repository.ownerLogin,
  };
}

async function ensureBranch(
  repoOwner: string,
  repoName: string,
  branchName: string,
  defaultBranch: string,
) {
  const baseSha = await readBranchHeadSha(repoOwner, repoName, defaultBranch);

  try {
    await githubNoContent(
      `/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/git/refs`,
      {
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: baseSha,
        }),
        method: "POST",
      },
    );
  } catch (error) {
    if (
      error instanceof GitHubIntegrationError &&
      error.status === 422 &&
      typeof error.details === "object" &&
      error.details !== null &&
      "message" in error.details &&
      typeof error.details.message === "string" &&
      error.details.message.includes("Reference already exists")
    ) {
      return;
    }

    throw error;
  }
}

async function getExistingFileSha(
  repoOwner: string,
  repoName: string,
  branchName: string,
  filePath: string,
) {
  try {
    const payload = await githubJson<{ sha?: string }>(
      `/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/contents/${filePath
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/")}?ref=${encodeURIComponent(branchName)}`,
    );

    return payload.sha ?? null;
  } catch (error) {
    if (error instanceof GitHubIntegrationError && error.status === 404) {
      return null;
    }

    throw error;
  }
}

async function upsertRunReportFile(
  repoOwner: string,
  repoName: string,
  branchName: string,
  filePath: string,
  content: string,
  commitMessage: string,
) {
  const sha = await getExistingFileSha(repoOwner, repoName, branchName, filePath);
  const payload = await githubJson<{ commit?: { sha?: string } }>(
    `/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/contents/${filePath
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/")}`,
    {
      body: JSON.stringify({
        branch: branchName,
        content: Buffer.from(content, "utf8").toString("base64"),
        message: commitMessage,
        ...(sha ? { sha } : {}),
      }),
      method: "PUT",
    },
  );

  return payload.commit?.sha ?? null;
}

async function findExistingPullRequest(
  repoOwner: string,
  repoName: string,
  branchName: string,
  defaultBranch: string,
) {
  const payload = await githubJson<
    Array<{
      html_url: string;
      number: number;
    }>
  >(
    `/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/pulls?state=open&head=${encodeURIComponent(
      `${repoOwner}:${branchName}`,
    )}&base=${encodeURIComponent(defaultBranch)}`,
  );

  return payload[0] ?? null;
}

async function getPullRequestMetadata(
  repoOwner: string,
  repoName: string,
  prNumber: number,
): Promise<GitHubPullRequestMetadata> {
  const pullRequest = await githubJson<{
    additions?: number;
    base?: {
      ref?: string;
    };
    changed_files?: number;
    comments?: number;
    commits?: number;
    created_at?: string;
    deletions?: number;
    draft?: boolean;
    head?: {
      ref?: string;
      sha?: string;
    };
    labels?: Array<{ name?: string }>;
    mergeable?: boolean | null;
    mergeable_state?: string | null;
    requested_reviewers?: Array<{ login?: string }>;
    review_comments?: number;
    state?: string;
    title?: string;
    updated_at?: string;
    user?: {
      login?: string;
    };
  }>(`/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/pulls/${prNumber}`);

  const headSha = pullRequest.head?.sha ?? null;
  let checksStatus: string | null = null;

  if (headSha) {
    try {
      const statusPayload = await githubJson<{ state?: string }>(
        `/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/commits/${encodeURIComponent(
          headSha,
        )}/status`,
      );

      checksStatus = statusPayload.state ?? null;
    } catch (error) {
      if (!(error instanceof GitHubIntegrationError && error.status === 404)) {
        throw error;
      }
    }
  }

  const requestedReviewerLogins =
    pullRequest.requested_reviewers
      ?.map((reviewer) => reviewer.login?.trim())
      .filter((login): login is string => Boolean(login)) ?? [];
  const additions = pullRequest.additions ?? null;
  const deletions = pullRequest.deletions ?? null;

  return {
    additions,
    authorLogin: pullRequest.user?.login ?? null,
    baseBranch: pullRequest.base?.ref ?? null,
    checksStatus,
    commitCount: pullRequest.commits ?? null,
    commentCount: pullRequest.comments ?? null,
    createdAt: pullRequest.created_at ?? null,
    deletions,
    githubState: pullRequest.state ?? null,
    githubUpdatedAt: pullRequest.updated_at ?? null,
    headBranch: pullRequest.head?.ref ?? null,
    headSha,
    labels:
      pullRequest.labels
        ?.map((label) => label.name?.trim())
        .filter((label): label is string => Boolean(label)) ?? [],
    isDraft: pullRequest.draft ?? null,
    lineChangeCount:
      additions != null && deletions != null
        ? additions + deletions
        : (additions ?? deletions ?? null),
    mergeable: pullRequest.mergeable ?? null,
    mergeableState: pullRequest.mergeable_state ?? null,
    metadataError: null,
    prTitle: pullRequest.title ?? null,
    prNumber,
    repoName,
    repoOwner,
    requestedReviewerCount: requestedReviewerLogins.length,
    requestedReviewerLogins,
    reviewCommentCount: pullRequest.review_comments ?? null,
    changedFiles: pullRequest.changed_files ?? null,
  };
}

async function ensurePullRequest(
  repoOwner: string,
  repoName: string,
  branchName: string,
  defaultBranch: string,
  title: string,
  body: string,
) {
  const existing = await findExistingPullRequest(repoOwner, repoName, branchName, defaultBranch);

  if (existing) {
    return existing;
  }

  return githubJson<{
    html_url: string;
    number: number;
  }>(`/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/pulls`, {
    body: JSON.stringify({
      base: defaultBranch,
      body,
      draft: true,
      head: branchName,
      title,
    }),
    method: "POST",
  });
}

export async function createRunPullRequest(
  input: RunPullRequestInput,
): Promise<GitHubPullRequestResult> {
  const repository = await getRepository(input.repoOwner, input.repoName);
  const publishedBranchName = input.publishedBranchName?.trim() || null;
  const branchName = buildRunBranchName(input.runId, publishedBranchName ?? input.branchName);
  const defaultBranch = input.defaultBranch?.trim() || repository.defaultBranch;
  const filePath = buildRunReportPath(input.runId);
  let commitSha = input.publishedCommitSha?.trim() || "";

  if (publishedBranchName) {
    await ensureRepositoryBranch(input.repoOwner, input.repoName, branchName);

    if (!commitSha) {
      commitSha = await readBranchHeadSha(input.repoOwner, input.repoName, branchName);
    }
  } else {
    const reportMarkdown = input.reportMarkdown?.trim() || buildRunReportMarkdown(input);

    await ensureBranch(input.repoOwner, input.repoName, branchName, defaultBranch);

    commitSha =
      (await upsertRunReportFile(
        input.repoOwner,
        input.repoName,
        branchName,
        filePath,
        reportMarkdown,
        buildRunCommitMessage(input),
      )) ?? "";
  }
  const pullRequest = await ensurePullRequest(
    input.repoOwner,
    input.repoName,
    branchName,
    defaultBranch,
    buildRunPullRequestTitle(input),
    buildRunPullRequestBody(input),
  );

  return {
    branchName,
    commitSha,
    filePath,
    prNumber: pullRequest.number,
    prUrl: pullRequest.html_url,
  };
}

export async function readGitHubPullRequestMetadata(
  prUrl: string,
): Promise<GitHubPullRequestMetadata> {
  const parsed = parsePullRequestUrl(prUrl);

  if (!parsed) {
    return {
      additions: null,
      authorLogin: null,
      baseBranch: null,
      checksStatus: null,
      commitCount: null,
      commentCount: null,
      createdAt: null,
      deletions: null,
      githubState: null,
      githubUpdatedAt: null,
      headBranch: null,
      headSha: null,
      labels: [],
      isDraft: null,
      lineChangeCount: null,
      mergeable: null,
      mergeableState: null,
      metadataError: "github_pull_request_url_invalid",
      prTitle: null,
      prNumber: null,
      repoName: null,
      repoOwner: null,
      requestedReviewerCount: null,
      requestedReviewerLogins: [],
      reviewCommentCount: null,
      changedFiles: null,
    };
  }

  if (!internalApiEnv.GITHUB_TOKEN) {
    return {
      additions: null,
      authorLogin: null,
      baseBranch: null,
      checksStatus: null,
      commitCount: null,
      commentCount: null,
      createdAt: null,
      deletions: null,
      githubState: null,
      githubUpdatedAt: null,
      headBranch: null,
      headSha: null,
      labels: [],
      isDraft: null,
      lineChangeCount: null,
      mergeable: null,
      mergeableState: null,
      metadataError: "github_token_not_configured",
      prTitle: null,
      prNumber: parsed.prNumber,
      repoName: parsed.repoName,
      repoOwner: parsed.repoOwner,
      requestedReviewerCount: null,
      requestedReviewerLogins: [],
      reviewCommentCount: null,
      changedFiles: null,
    };
  }

  try {
    return await getPullRequestMetadata(parsed.repoOwner, parsed.repoName, parsed.prNumber);
  } catch (error) {
    return {
      additions: null,
      authorLogin: null,
      baseBranch: null,
      checksStatus: null,
      commitCount: null,
      commentCount: null,
      createdAt: null,
      deletions: null,
      githubState: null,
      githubUpdatedAt: null,
      headBranch: null,
      headSha: null,
      labels: [],
      isDraft: null,
      lineChangeCount: null,
      mergeable: null,
      mergeableState: null,
      metadataError:
        error instanceof Error && error.message
          ? error.message
          : "github_pull_request_metadata_unavailable",
      prTitle: null,
      prNumber: parsed.prNumber,
      repoName: parsed.repoName,
      repoOwner: parsed.repoOwner,
      requestedReviewerCount: null,
      requestedReviewerLogins: [],
      reviewCommentCount: null,
      changedFiles: null,
    };
  }
}
