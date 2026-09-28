import { NextRequest, NextResponse } from "next/server";
import { requireKodyUser } from "@dashboard/lib/auth/kody-user";
import {
  deleteHermesSession,
  getHermesSession,
  getHermesSessionMessages,
  updateHermesSession,
} from "@dashboard/lib/hermes/runtime";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const actor = await requireKodyUser();
  if (actor instanceof NextResponse) return actor;
  const { sessionId } = await context.params;
  if (!sessionId || sessionId.length > 200) {
    return NextResponse.json({ error: "Invalid Hermes session id." }, { status: 400 });
  }
  try {
    const [sessionResult, history] = await Promise.all([
      getHermesSession(sessionId),
      getHermesSessionMessages(sessionId),
    ]);
    const session =
      sessionResult.session && typeof sessionResult.session === "object"
        ? sessionResult.session
        : sessionResult;
    return NextResponse.json({ session, history }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Hermes session history failed." },
      { status: 502 },
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const actor = await requireKodyUser();
  if (actor instanceof NextResponse) return actor;
  const { sessionId } = await context.params;
  if (!sessionId || sessionId.length > 200) {
    return NextResponse.json({ error: "Invalid Hermes session id." }, { status: 400 });
  }
  const body = await request.json().catch(() => null) as {
    title?: unknown;
    pinned?: unknown;
    runtimeSessionId?: unknown;
  } | null;
  if (!body || (body.title !== undefined && typeof body.title !== "string") ||
      (body.pinned !== undefined && typeof body.pinned !== "boolean") ||
      (body.runtimeSessionId !== undefined &&
        (typeof body.runtimeSessionId !== "string" || body.runtimeSessionId.length > 200)) ||
      (body.title === undefined && body.pinned === undefined)) {
    return NextResponse.json({ error: "Invalid session update." }, { status: 400 });
  }
  try {
    await updateHermesSession(sessionId, {
      ...(typeof body.title === "string" ? { title: body.title.slice(0, 200) } : {}),
      ...(typeof body.pinned === "boolean" ? { pinned: body.pinned } : {}),
    }, typeof body.runtimeSessionId === "string" ? body.runtimeSessionId : undefined);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Hermes session update failed." },
      { status: 502 },
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const actor = await requireKodyUser();
  if (actor instanceof NextResponse) return actor;
  const { sessionId } = await context.params;
  if (!sessionId || sessionId.length > 200) {
    return NextResponse.json({ error: "Invalid Hermes session id." }, { status: 400 });
  }
  try {
    const body = await request.json().catch(() => null) as { runtimeSessionId?: unknown } | null;
    if (body?.runtimeSessionId !== undefined &&
        (typeof body.runtimeSessionId !== "string" || body.runtimeSessionId.length > 200)) {
      return NextResponse.json({ error: "Invalid Hermes runtime session id." }, { status: 400 });
    }
    await deleteHermesSession(sessionId,
      typeof body?.runtimeSessionId === "string" ? body.runtimeSessionId : undefined);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Hermes session deletion failed." },
      { status: 502 },
    );
  }
}
