import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyRepoWriteAccess } from "@kody-ade/base/auth";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { resolveAppHostingConfig } from "@kody-ade/fly/apps/config";
import {
  addCertificate,
  removeCertificate,
} from "@kody-ade/fly/apps/resources-client";
const schema = z.object({
  action: z.enum(["add", "remove"]),
  hostname: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
    ),
});
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const access = await verifyRepoWriteAccess(req);
  if (access instanceof NextResponse) return access;
  const input = schema.safeParse(await req.json().catch(() => null));
  if (!input.success)
    return NextResponse.json({ error: "invalid_app_domain" }, { status: 400 });
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
  try {
    if (input.data.action === "add")
      await addCertificate(app.provider.appName, input.data.hostname, cfg);
    else
      await removeCertificate(app.provider.appName, input.data.hostname, cfg);
    const domains =
      input.data.action === "add"
        ? [
            ...app.domains.filter(
              (item: { hostname: string }) =>
                item.hostname !== input.data.hostname,
            ),
            { hostname: input.data.hostname, status: "pending" },
          ]
        : app.domains.filter(
            (item: { hostname: string }) =>
              item.hostname !== input.data.hostname,
          );
    await backend.mutation(backendApi.apps.patch, {
      tenantId,
      appId: app.appId,
      domains,
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, domains });
  } catch {
    return NextResponse.json(
      { error: "app_domain_action_failed" },
      { status: 502 },
    );
  }
}
