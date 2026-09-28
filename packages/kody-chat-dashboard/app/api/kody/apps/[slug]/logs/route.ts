import { NextRequest, NextResponse } from "next/server";
import { verifyRepoReadAccess } from "@kody-ade/base/auth";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { resolveAppHostingConfig } from "@kody-ade/fly/apps/config";
import { readAppLogs } from "@kody-ade/fly/apps/resources-client";
import { readVault } from "@kody-ade/base/vault/store";
function redact(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") {
    let text = value
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
      .replace(/kody_app_[A-Za-z0-9_-]+/g, "[REDACTED]");
    for (const secret of secrets.filter((item) => item.length >= 4))
      text = text.split(secret).join("[REDACTED]");
    return text;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        /token|secret|password|authorization|cookie/i.test(key)
          ? [key, "[REDACTED]"]
          : [key, redact(item, secrets)],
      ]),
    );
  return value;
}
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const access = await verifyRepoReadAccess(req);
  if (access instanceof NextResponse) return access;
  const tenantId = `${access.auth.owner}/${access.auth.repo}`,
    { slug } = await params;
  const app = await createBackendClient().query(backendApi.apps.get, {
    tenantId,
    slug,
  });
  if (!app)
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  const cfg = resolveAppHostingConfig();
  if (!cfg)
    return NextResponse.json(
      { error: "app_hosting_unavailable" },
      { status: 503 },
    );
  try {
    const vault = await readVault(
        access.octokit,
        access.auth.owner,
        access.auth.repo,
      ),
      secretValues = [
        cfg.token,
        ...app.secretNames
          .map((name: string) => vault.doc.secrets[name]?.value)
          .filter(
            (value: unknown): value is string => typeof value === "string",
          ),
      ];
    return NextResponse.json(
      redact(
        await readAppLogs(
          app.provider.appName,
          cfg,
          req.nextUrl.searchParams.get("cursor") ?? undefined,
        ),
        secretValues,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "app_logs_unavailable" },
      { status: 502 },
    );
  }
}
