import { NextRequest, NextResponse } from "next/server";
import { handleKodyMcpPost } from "@kody-ade/kody-chat-dashboard/routes/kody/mcp";
import { createKodyMcpActionServices } from "@dashboard/lib/mcp/action-services";
import {
  requireBrainAgent,
  requireAgentRepository,
  agentError,
} from "@dashboard/lib/brain/agent-access";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const identity = await requireBrainAgent(req);
    if (identity instanceof NextResponse) return identity;
    const repository = req.headers.get("x-kody-agent-repository") ?? "";
    const access = await requireAgentRepository(
      req,
      identity.userId,
      repository,
    );
    if (access instanceof NextResponse) return access;
    return await handleKodyMcpPost(req, {
      services: createKodyMcpActionServices({ origin: req.nextUrl.origin }),
      authenticate: async () => ({
        tokenId: identity.tokenId,
        name: "Brain " + identity.app,
        tenantId: access.auth.owner + "/" + access.auth.repo,
        actorLogin: access.actorLogin,
        actorGithubId: access.actorGithubId,
        createdAt: identity.createdAt,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        scopes: [
          "mcp:read",
          "mcp:execute",
          "memory:personal:read",
          "memory:personal:write",
          "memory:personal:delete",
          "memory:repository:read",
          "memory:repository:write",
          "memory:repository:delete",
        ],
      }),
    });
  } catch {
    return agentError("kody_access_unavailable", 503);
  }
}
