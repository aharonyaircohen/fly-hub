import { NextResponse } from "next/server";
import { requireKodyUser } from "@dashboard/lib/auth/kody-user";
import { getHermesModels } from "@dashboard/lib/hermes/runtime";

export const runtime = "nodejs";

export async function GET() {
  const actor = await requireKodyUser();
  if (actor instanceof NextResponse) return actor;

  try {
    return NextResponse.json(await getHermesModels(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Hermes model list failed.",
    }, { status: 502 });
  }
}
