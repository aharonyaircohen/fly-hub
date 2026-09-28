import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyRepoWriteAccess } from "@kody-ade/base/auth";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import {
  generateMcpAccessToken,
  hashMcpAccessToken,
} from "../../../../../src/dashboard/lib/mcp/access-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const createSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    expiresInDays: z.number().int().min(1).max(365).default(90),
    access: z.enum(["read", "execute"]).default("execute"),
    memoryScope: z.enum(["repository", "all"]).default("all"),
    allowMemoryDelete: z.boolean().default(true),
  })
  .strict();
const revokeSchema = z.object({ tokenId: z.string().uuid() }).strict();

export async function GET(req: NextRequest) {
  const access = await verifyRepoWriteAccess(req);
  if (access instanceof NextResponse) return access;
  const tokens = await createBackendClient().query(
    backendApi.mcpAccessTokens.list,
    {
      tenantId: `${access.auth.owner}/${access.auth.repo}`,
      actorLogin: access.actorLogin,
    },
  );
  return NextResponse.json({ tokens }, { headers: NO_STORE_HEADERS });
}

export async function POST(req: NextRequest) {
  const access = await verifyRepoWriteAccess(req);
  if (access instanceof NextResponse) return access;
  const input = createSchema.safeParse(await req.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { error: "invalid_token_request" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  const accessToken = generateMcpAccessToken();
  const createdAt = new Date();
  const expiresAt = new Date(
    createdAt.getTime() + input.data.expiresInDays * 24 * 60 * 60 * 1000,
  );
  const record = await createBackendClient().mutation(
    backendApi.mcpAccessTokens.create,
    {
      tokenId: crypto.randomUUID(),
      tokenHash: hashMcpAccessToken(accessToken),
      name: input.data.name,
      tenantId: `${access.auth.owner}/${access.auth.repo}`,
      actorLogin: access.actorLogin,
      actorGithubId: access.actorGithubId,
      scopes: [
        "mcp:read",
        ...(input.data.access === "execute" ? ["mcp:execute"] : []),
        ...(input.data.memoryScope === "all"
          ? ["personal", "repository"]
          : ["repository"]
        ).flatMap((scope) => [
          `memory:${scope}:read`,
          ...(input.data.access === "execute"
            ? [
                `memory:${scope}:write`,
                ...(input.data.allowMemoryDelete
                  ? [`memory:${scope}:delete`]
                  : []),
              ]
            : []),
        ]),
      ],
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
  );
  return NextResponse.json(
    { accessToken, token: record },
    { status: 201, headers: NO_STORE_HEADERS },
  );
}

export async function DELETE(req: NextRequest) {
  const access = await verifyRepoWriteAccess(req);
  if (access instanceof NextResponse) return access;
  const input = revokeSchema.safeParse(await req.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { error: "invalid_token_revoke_request" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  const revoked = await createBackendClient().mutation(
    backendApi.mcpAccessTokens.revoke,
    {
      tenantId: `${access.auth.owner}/${access.auth.repo}`,
      actorLogin: access.actorLogin,
      tokenId: input.data.tokenId,
      revokedAt: new Date().toISOString(),
    },
  );
  if (!revoked)
    return NextResponse.json(
      { error: "mcp_access_token_not_found" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
}
