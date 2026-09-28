import { NextRequest, NextResponse } from "next/server";
import { requireKodyUser } from "@dashboard/lib/auth/kody-user";
import { attachHermesFile } from "@dashboard/lib/hermes/runtime";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const actor = await requireKodyUser();
  if (actor instanceof NextResponse) return actor;
  const { sessionId } = await context.params;
  if (!sessionId || sessionId.length > 200) {
    return NextResponse.json({ error: "Invalid Hermes session id." }, { status: 400 });
  }
  const body = await request.json().catch(() => null) as {
    name?: unknown;
    dataUrl?: unknown;
    runtimeSessionId?: unknown;
  } | null;
  if (!body || typeof body.name !== "string" || body.name.length > 255 ||
      typeof body.dataUrl !== "string" || !body.dataUrl.startsWith("data:") ||
      (body.runtimeSessionId !== undefined &&
        (typeof body.runtimeSessionId !== "string" || body.runtimeSessionId.length > 200))) {
    return NextResponse.json({ error: "Invalid file attachment." }, { status: 400 });
  }
  try {
    return NextResponse.json(await attachHermesFile(sessionId, {
      name: body.name,
      dataUrl: body.dataUrl,
    }, typeof body.runtimeSessionId === "string" ? body.runtimeSessionId : undefined),
    { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Hermes could not attach this file." },
      { status: 502 },
    );
  }
}
