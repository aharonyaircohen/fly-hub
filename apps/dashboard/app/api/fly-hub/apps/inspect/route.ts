import { NextRequest, NextResponse } from "next/server";
import { inspectPublicGitHubApp } from "@kody-ade/fly/hub/app-source";
import { requireHubConfig, sameOrigin } from "@kody-ade/fly/hub/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req))
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  const auth = requireHubConfig(req);
  if ("response" in auth) return auth.response;
  const body = (await req.json().catch(() => null)) as {
    url?: unknown;
    rootDirectory?: unknown;
  } | null;
  if (
    typeof body?.url !== "string" ||
    body.url.length > 500 ||
    (body.rootDirectory !== undefined &&
      (typeof body.rootDirectory !== "string" ||
        body.rootDirectory.length > 200))
  )
    return NextResponse.json(
      { error: "Enter a GitHub repository URL." },
      { status: 400 },
    );
  try {
    const result = await inspectPublicGitHubApp({
      url: body.url,
      org: auth.cfg.orgSlug,
      rootDirectory: body.rootDirectory as string | undefined,
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not inspect repository.",
      },
      { status: 400 },
    );
  }
}
