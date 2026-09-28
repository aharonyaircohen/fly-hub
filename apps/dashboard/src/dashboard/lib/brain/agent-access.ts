import "@dashboard/lib/brain/personal-services";
import { NextRequest, NextResponse } from "next/server";
import {
  authenticateAgentAccess,
  agentTokenId,
} from "@kody-ade/brain/agent-access";
import { getPersonalBrainServices } from "@kody-ade/brain/personal-services";
import { verifyRepoWriteAccess } from "@kody-ade/base/auth";
import { buildKodyAuthHeaders } from "@kody-ade/base/auth-headers";
import {
  backendApi,
  getConvexClient,
} from "@dashboard/lib/backend/convex-backend";
import {
  ACCOUNT_REPOSITORY_CREDENTIAL_NAME,
  parseAccountRepositoryCredentials,
} from "@dashboard/lib/auth/account-repository-connections";

export const privateHeaders = { "Cache-Control": "no-store, max-age=0" };
export const agentError = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: privateHeaders });

export async function requireBrainAgent(req: NextRequest) {
  const raw = req.headers.get("authorization") ?? "";
  const token = raw.startsWith("Bearer ") ? raw.slice(7) : "";
  const identity = await authenticateAgentAccess(token);
  if (!identity) return agentError("unauthorized", 401);
  const tokenId = agentTokenId(token);
  const allowed = await getConvexClient().mutation(
    backendApi.mcpRateLimits.check,
    {
      key: "brain-agent:" + tokenId,
      now: Math.floor(Date.now() / 1000),
      windowSec: 60,
      limit: 120,
    },
  );
  if (!allowed) return agentError("rate_limit_exceeded", 429);
  return { ...identity, tokenId };
}

/** Never trust a repository or GitHub credential supplied by the remote caller. */
export async function requireAgentRepository(
  req: NextRequest,
  userId: string,
  repository: string,
) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    return agentError("repository_required", 400);
  const services = getPersonalBrainServices();
  let token = await services.getCredential(userId, "GITHUB_TOKEN");
  if (!token) {
    const saved = await services.getCredential(
      userId,
      ACCOUNT_REPOSITORY_CREDENTIAL_NAME,
    );
    if (saved) {
      try {
        token =
          parseAccountRepositoryCredentials(JSON.parse(saved)).find(
            (entry) => `${entry.owner}/${entry.repo}` === repository,
          )?.token ?? null;
      } catch {
        token = null;
      }
    }
  }
  if (!token) return agentError("personal_github_token_missing", 403);
  const [owner, repo] = repository.split("/");
  return verifyRepoWriteAccess(
    new NextRequest(req.url, {
      headers: buildKodyAuthHeaders({ token, owner, repo }),
    }),
  );
}
