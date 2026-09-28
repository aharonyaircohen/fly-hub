import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyRepoWriteAccess } from "@kody-ade/base/auth";
import { readVault } from "@kody-ade/base/vault/store";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { POST as deployApp } from "../deployments/route";
const schema = z.object({
  secretNames: z.array(z.string().regex(/^[A-Z_][A-Z0-9_]{0,127}$/)).max(100),
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
      { error: "invalid_app_environment" },
      { status: 400 },
    );
  const tenantId = `${access.auth.owner}/${access.auth.repo}`,
    { slug } = await params,
    backend = createBackendClient(),
    app = await backend.query(backendApi.apps.get, { tenantId, slug });
  if (!app)
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  const vault = await readVault(
      access.octokit,
      access.auth.owner,
      access.auth.repo,
    ),
    missing = input.data.secretNames.filter(
      (name) => !vault.doc.secrets[name]?.value,
    );
  if (missing.length)
    return NextResponse.json(
      { error: "missing_app_secrets", names: missing },
      { status: 409 },
    );
  const deployment = app.currentDeploymentId
    ? await backend.query(backendApi.appDeployments.get, {
        tenantId,
        appId: app.appId,
        deploymentId: app.currentDeploymentId,
      })
    : null;
  if (!deployment)
    return NextResponse.json(
      { error: "app_deployment_required" },
      { status: 409 },
    );
  await backend.mutation(backendApi.apps.patch, {
    tenantId,
    appId: app.appId,
    secretNames: input.data.secretNames,
    updatedAt: new Date().toISOString(),
  });
  const deployReq = new NextRequest(req.nextUrl, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify({
      requestId: crypto.randomUUID(),
      commitSha: deployment.commitSha,
    }),
  });
  return deployApp(deployReq, { params: Promise.resolve({ slug }) });
}
