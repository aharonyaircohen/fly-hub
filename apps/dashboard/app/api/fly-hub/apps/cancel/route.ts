import { NextRequest, NextResponse } from "next/server";
import { requireHubConfig, sameOrigin } from "@kody-ade/fly/hub/session";
import { requestAppCancellation } from "@kody-ade/fly/hub/app-cancellation";

export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  if (!sameOrigin(req))
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 },
    );
  const auth = requireHubConfig(req);
  if ("response" in auth) return auth.response;
  const body = await req.json().catch(() => null);
  if (
    typeof body?.appName !== "string" ||
    typeof body?.workerId !== "string" ||
    !/^[a-f0-9]{12,32}$/.test(body.workerId)
  )
    return NextResponse.json(
      { error: "Choose the setup job to cancel." },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      {
        ok: true,
        ...(await requestAppCancellation({
          cfg: auth.cfg,
          appName: body.appName,
          workerId: body.workerId,
        })),
      },
      { status: 202, headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not cancel setup.",
      },
      { status: 502 },
    );
  }
}
