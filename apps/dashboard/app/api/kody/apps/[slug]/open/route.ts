import "@dashboard/lib/chat/personal-model-settings";
import { NextRequest, NextResponse } from "next/server";
import { requireKodyUser } from "@dashboard/lib/auth/kody-user";
import {
  GET as packageGET,
  POST as packagePOST,
} from "@kody-ade/kody-chat-dashboard/routes/kody/apps-open";
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const user = await requireKodyUser();
  return user instanceof NextResponse ? user : packageGET(req, ctx);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const user = await requireKodyUser();
  return user instanceof NextResponse ? user : packagePOST(req, ctx);
}
