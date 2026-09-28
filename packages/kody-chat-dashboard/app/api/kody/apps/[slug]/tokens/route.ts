import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyRepoWriteAccess } from "@kody-ade/base/auth";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import {
  generateAppAccessToken,
  hashAppAccessToken,
} from "@kody-ade/fly/apps/access-token";
import {
  listMachines,
  updateMachineEnv,
} from "@kody-ade/fly/apps/machines-client";
import { resolveAppHostingConfig } from "@kody-ade/fly/apps/config";

const schema = z.object({
  action: z.enum(["create", "revoke"]),
  name: z.string().trim().min(1).max(80).optional(),
  tokenId: z.string().uuid().optional(),
});
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const access = await verifyRepoWriteAccess(req);
  if (access instanceof NextResponse) return access;
  const input = schema.safeParse(await req.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { error: "invalid_token_action" },
      { status: 400 },
    );
  const tenantId = `${access.auth.owner}/${access.auth.repo}`,
    { slug } = await params,
    backend = createBackendClient();
  const app = await backend.query(backendApi.apps.get, { tenantId, slug });
  if (!app)
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  const cfg = resolveAppHostingConfig();
  if (!cfg)
    return NextResponse.json(
      { error: "app_hosting_unavailable" },
      { status: 503 },
    );
  const now = new Date().toISOString();
  let plain: string | undefined;
  let nextTokens = app.accessTokens;
  if (input.data.action === "create") {
    plain = generateAppAccessToken();
    nextTokens = [
      ...app.accessTokens,
      {
        tokenId: crypto.randomUUID(),
        name: input.data.name ?? "Consumer",
        tokenHash: hashAppAccessToken(plain),
        createdAt: now,
      },
    ];
  } else {
    if (!input.data.tokenId)
      return NextResponse.json({ error: "token_id_required" }, { status: 400 });
    if (
      !app.accessTokens.some(
        (token) => token.tokenId === input.data.tokenId && !token.revokedAt,
      )
    )
      return NextResponse.json(
        { error: "app_access_token_not_found" },
        { status: 404 },
      );
    nextTokens = app.accessTokens.map((token) =>
      token.tokenId === input.data.tokenId
        ? { ...token, revokedAt: now }
        : token,
    );
  }
  const hashes = nextTokens
    .filter((token) => !token.revokedAt)
    .map((token) => token.tokenHash)
    .join(",");
  const machines = await listMachines(app.provider.appName, cfg);
  const gateways = machines.filter((machine) =>
    Boolean(
      (machine.config?.env as Record<string, string> | undefined)
        ?.KODY_APP_TOKEN_HASHES,
    ),
  );
  if (!gateways.length)
    return NextResponse.json(
      { error: "app_gateway_missing", repairable: true },
      { status: 409 },
    );
  await Promise.all(
    gateways.map((machine) =>
      updateMachineEnv(
        app.provider.appName,
        machine.id,
        { KODY_APP_TOKEN_HASHES: hashes },
        cfg,
      ),
    ),
  );
  if (input.data.action === "create") {
    const token = nextTokens[nextTokens.length - 1];
    await backend.mutation(backendApi.apps.addAccessToken, {
      tenantId,
      appId: app.appId,
      token,
      updatedAt: now,
    });
  } else
    await backend.mutation(backendApi.apps.revokeAccessToken, {
      tenantId,
      appId: app.appId,
      tokenId: input.data.tokenId!,
      revokedAt: now,
    });
  return NextResponse.json({
    ok: true,
    ...(plain ? { accessToken: plain } : {}),
  });
}
