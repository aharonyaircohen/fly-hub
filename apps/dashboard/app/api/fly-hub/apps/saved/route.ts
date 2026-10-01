import { NextRequest, NextResponse } from "next/server";
import { requireHubConfig, sameOrigin } from "@kody-ade/fly/hub/session";
import {
  listSavedApps,
  savedAppJobs,
  startSavedAppJob,
  deleteSavedApp,
} from "@kody-ade/fly/hub/saved-apps";
import { readRegistrySession } from "@dashboard/lib/fly-hub-registry-session";
export const runtime = "nodejs";
export const maxDuration = 120;
const headers = { "Cache-Control": "no-store, private" };
export async function GET(req: NextRequest) {
  const auth = requireHubConfig(req);
  if ("response" in auth) return auth.response;
  const registry = readRegistrySession(req);
  if (!registry)
    return NextResponse.json(
      { error: "Connect GitHub registry to save or restore apps." },
      { status: 401, headers },
    );
  try {
    const jobs = await savedAppJobs(auth.cfg, registry);
    const jobId = req.nextUrl.searchParams.get("job");
    if (jobId) {
      const job = jobs.find((j) => j.jobId === jobId);
      return job
        ? NextResponse.json({ job }, { headers })
        : NextResponse.json(
            { error: "Saved app job not found." },
            { status: 404, headers },
          );
    }
    return NextResponse.json(
      {
        saved: await listSavedApps(registry.user, registry.token),
        jobs: jobs.slice(0, 10),
      },
      { headers },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not read saved apps.",
      },
      { status: 502, headers },
    );
  }
}
export async function POST(req: NextRequest) {
  if (!sameOrigin(req))
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 },
    );
  const auth = requireHubConfig(req);
  if ("response" in auth) return auth.response;
  const registry = readRegistrySession(req);
  if (!registry)
    return NextResponse.json(
      { error: "Connect GitHub registry to save or restore apps." },
      { status: 401, headers },
    );
  const body = await req.json().catch(() => null);
  if (
    !body ||
    (body.action !== "save" && body.action !== "create") ||
    (body.action === "save"
      ? typeof body.app !== "string"
      : typeof body.id !== "string" || typeof body.name !== "string")
  )
    return NextResponse.json(
      { error: "Invalid saved app request." },
      { status: 400, headers },
    );
  try {
    return NextResponse.json(
      { job: await startSavedAppJob(auth.cfg, registry, body) },
      { status: 202, headers },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not start saved app operation.",
      },
      { status: 400, headers },
    );
  }
}

export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req))
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403, headers },
    );
  const auth = requireHubConfig(req);
  if ("response" in auth) return auth.response;
  const registry = readRegistrySession(req);
  if (!registry)
    return NextResponse.json(
      { error: "Connect GitHub to delete saved versions." },
      { status: 401, headers },
    );
  const body = await req.json().catch(() => null);
  if (
    typeof body?.id !== "string" ||
    !/^[a-f0-9]{32}$/.test(body.id) ||
    body.confirmId !== body.id
  )
    return NextResponse.json(
      { error: "Confirm the saved version you want to delete." },
      { status: 400, headers },
    );
  try {
    await deleteSavedApp(auth.cfg, registry, body.id);
    return NextResponse.json({ ok: true, deletedId: body.id }, { headers });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not delete saved version.",
      },
      { status: 400, headers },
    );
  }
}
