import { NextRequest, NextResponse } from "next/server";
import { requireHubConfig, sameOrigin } from "@kody-ade/fly/hub/session";
import {
  AppDeletionError,
  deleteFlyHubApp,
} from "@kody-ade/fly/hub/app-management";

export const runtime = "nodejs";
export const maxDuration = 120;
const headers = { "Cache-Control": "no-store, private" };
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ app: string }> },
) {
  if (!sameOrigin(req))
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403, headers },
    );
  const auth = requireHubConfig(req);
  if ("response" in auth) return auth.response;
  const { app } = await context.params;
  const body = await req.json().catch(() => null);
  if (body?.confirmApp !== app)
    return NextResponse.json(
      { error: "Confirm the app you want to delete." },
      { status: 400, headers },
    );
  try {
    return NextResponse.json(
      { ok: true, ...(await deleteFlyHubApp(app, auth.cfg)) },
      { headers },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof AppDeletionError
            ? error.message
            : "Could not verify this app for deletion. No deletion was started.",
        deletedApps: error instanceof AppDeletionError ? error.deletedApps : [],
      },
      {
        status: error instanceof AppDeletionError ? error.status : 502,
        headers,
      },
    );
  }
}
