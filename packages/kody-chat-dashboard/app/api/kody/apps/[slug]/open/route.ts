import { NextRequest, NextResponse } from "next/server";
import { verifyRepoReadAccess } from "@kody-ade/base/auth";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { mintAppLaunchTicket } from "@kody-ade/fly/apps/access-ticket";
import { resolveAppHostingConfig } from "@kody-ade/fly/apps/config";
import {
  listMachines,
  startMachine,
  waitForMachineStarted,
} from "@kody-ade/fly/apps/machines-client";
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const response = await resolveLaunch(req, { params });
  return response instanceof NextResponse
    ? response
    : NextResponse.redirect(response, 302);
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const response = await resolveLaunch(req, context);
  if (response instanceof NextResponse) return response;
  return NextResponse.json(
    { url: response.toString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function resolveLaunch(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<URL | NextResponse> {
  const access = await verifyRepoReadAccess(req);
  if (access instanceof NextResponse) return access;
  const tenantId = `${access.auth.owner}/${access.auth.repo}`,
    { slug } = await params,
    app = await createBackendClient().query(backendApi.apps.get, {
      tenantId,
      slug,
    });
  if (!app)
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  if (app.desiredStatus === "stopped")
    return NextResponse.json({ error: "app_stopped" }, { status: 409 });
  if (!app.provider.publicUrl)
    return NextResponse.json({ error: "app_url_unavailable" }, { status: 409 });
  const cfg = resolveAppHostingConfig();
  if (!cfg)
    return NextResponse.json(
      { error: "app_hosting_unavailable" },
      { status: 503 },
    );
  const machines = await listMachines(app.provider.appName, cfg);
  if (!machines.length)
    return NextResponse.json({ error: "app_machine_missing" }, { status: 409 });
  const sleeping = machines.filter((machine) => machine.state !== "started");
  await Promise.all(
    sleeping.map((machine) =>
      startMachine(app.provider.appName, machine.id, cfg),
    ),
  );
  await Promise.all(
    sleeping.map((machine) =>
      waitForMachineStarted(app.provider.appName, machine.id, cfg),
    ),
  );
  const url = new URL(app.provider.publicUrl);
  if (app.exposure === "private")
    url.searchParams.set("ka", mintAppLaunchTicket(tenantId, app.appId).ticket);
  return url;
}
