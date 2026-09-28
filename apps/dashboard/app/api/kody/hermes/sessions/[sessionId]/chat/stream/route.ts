import { NextRequest, NextResponse } from "next/server";
import { requireKodyUser } from "@dashboard/lib/auth/kody-user";
import { streamHermesTurn } from "@dashboard/lib/hermes/runtime";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const actor = await requireKodyUser();
  if (actor instanceof NextResponse) return actor;

  const { sessionId } = await context.params;
  if (!sessionId || sessionId.length > 200) {
    return NextResponse.json({ error: "Invalid Hermes session id." }, { status: 400 });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.message !== "string" || !body.message.trim()) {
    return NextResponse.json({ error: "A message is required." }, { status: 400 });
  }
  const runtimeSessionId = typeof body.runtimeSessionId === "string" && body.runtimeSessionId.length <= 200
    ? body.runtimeSessionId : undefined;

  try {
    const upstream = await streamHermesTurn(sessionId, body, request.signal, runtimeSessionId);
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      return NextResponse.json(
        { error: detail || `Hermes returned HTTP ${upstream.status}.` },
        { status: upstream.status || 502 },
      );
    }
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Hermes could not run this turn." },
      { status: 502 },
    );
  }
}
