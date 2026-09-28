import type {
  EngineExecutionReceipt,
  EngineExecutionRequest,
} from "@kody-ade/engine-contracts";
import { buildKodyWorkflowDispatchInputs } from "@dashboard/lib/kody-workflow-dispatch";

interface GitHubActionsClient {
  rest: {
    repos: {
      get(input: {
        owner: string;
        repo: string;
      }): Promise<{ data: { default_branch?: string | null } }>;
      getContent?(input: {
        owner: string;
        repo: string;
        path: string;
        ref?: string;
      }): Promise<{ data: unknown }>;
    };
    actions: {
      createWorkflowDispatch(input: {
        owner: string;
        repo: string;
        workflow_id: string;
        ref: string;
        inputs: Record<string, string>;
      }): Promise<unknown>;
    };
  };
}

interface GitHubActionsEngineGatewayOptions {
  octokit: GitHubActionsClient;
  owner: string;
  repo: string;
  dashboardUrl?: string;
  storeRepoUrl?: string;
  storeRef?: string;
  model?: string;
  now?: () => Date;
}

function githubRepositorySlug(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const match = /^(?:https?:\/\/github\.com\/|git@github\.com:)?([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(
    trimmed,
  );
  return match?.[1];
}

const CACHE_TTL_MS = 60_000;
const defaultBranchCache = new Map<
  string,
  { branch: string; expiresAt: number }
>();
const defaultBranchInflight = new Map<string, Promise<string>>();

async function readDefaultBranch(
  octokit: GitHubActionsClient,
  owner: string,
  repo: string,
): Promise<string> {
  const key = `${owner}/${repo}`.toLowerCase();
  const cached = defaultBranchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.branch;

  const existing = defaultBranchInflight.get(key);
  if (existing) return existing;

  const promise = octokit.rest.repos
    .get({ owner, repo })
    .then((result) => result.data.default_branch || "main")
    .then((branch) => {
      defaultBranchCache.set(key, {
        branch,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return branch;
    })
    .finally(() => {
      defaultBranchInflight.delete(key);
    });
  defaultBranchInflight.set(key, promise);
  return promise;
}

export function createGitHubActionsEngineGateway({
  octokit,
  owner,
  repo,
  dashboardUrl,
  storeRepoUrl,
  storeRef,
  model,
  now = () => new Date(),
}: GitHubActionsEngineGatewayOptions) {
  return async function dispatch(
    request: EngineExecutionRequest,
  ): Promise<EngineExecutionReceipt> {
    const ref = await readDefaultBranch(octokit, owner, repo);
    const inputs = await buildKodyWorkflowDispatchInputs(
      octokit,
      {
        owner,
        repo,
        ref,
        requestId: request.requestId,
        executionRequest: request,
        model,
        dashboardUrl,
        storeRepoUrl: githubRepositorySlug(storeRepoUrl),
        storeRef,
      },
      { cache: true },
    );
    await octokit.rest.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: "kody.yml",
      ref,
      inputs,
    });
    return { requestId: request.requestId, acceptedAt: now().toISOString() };
  };
}
