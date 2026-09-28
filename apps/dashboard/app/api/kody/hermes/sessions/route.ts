import { NextRequest, NextResponse } from "next/server";
import { requireKodyUser } from "@dashboard/lib/auth/kody-user";
import { createHermesSession, listHermesSessions } from "@dashboard/lib/hermes/runtime";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const actor = await requireKodyUser();
  if (actor instanceof NextResponse) return actor;

  try {
    const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 100));
    const requestedSource = request.nextUrl.searchParams.get("source");
    const source = requestedSource === "kody-vibe-default" ? requestedSource : "kody-global";
    return NextResponse.json(await listHermesSessions(limit, source), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Hermes session listing failed." },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  const actor = await requireKodyUser();
  if (actor instanceof NextResponse) return actor;

  const body = await request.json().catch(() => null) as {
    sessionId?: unknown;
    title?: unknown;
    model?: unknown;
    reasoningEffort?: unknown;
    source?: unknown;
  } | null;
  if (!body || (body.sessionId !== undefined && (typeof body.sessionId !== "string" || body.sessionId.length > 200)) ||
      (body.title !== undefined && typeof body.title !== "string") ||
      (body.model !== undefined && typeof body.model !== "string") ||
      (body.reasoningEffort !== undefined && typeof body.reasoningEffort !== "string") ||
      (body.source !== undefined && body.source !== "kody-global" && body.source !== "kody-vibe-default")) {
    return NextResponse.json({ error: "Invalid Hermes session options." }, { status: 400 });
  }

  try {
    const session = await createHermesSession({
      title: typeof body.title === "string" ? body.title.slice(0, 200) : undefined,
      model: typeof body.model === "string" ? body.model.slice(0, 200) : undefined,
      reasoningEffort: typeof body.reasoningEffort === "string" ? body.reasoningEffort.slice(0, 40) : undefined,
      source: typeof body.source === "string" ? body.source : "kody-global",
    });
    const storedSessionId = String(session.stored_session_id ?? session.session_id ?? "");
    const runtimeSessionId = String(session.session_id ?? "");
    if (!storedSessionId || !runtimeSessionId) {
      throw new Error("Hermes returned incomplete session ids.");
    }
    return NextResponse.json(
      { ...session, id: storedSessionId, stored_session_id: storedSessionId, session_id: runtimeSessionId },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Hermes session creation failed." },
      { status: 502 },
    );
  }
}
