import "@dashboard/lib/chat/personal-model-settings";
import { NextRequest, NextResponse } from "next/server";
import { requireKodyUser } from "@dashboard/lib/auth/kody-user";
import {
  GET as packageGET,
  PATCH as packagePATCH,
  DELETE as packageDELETE,
} from "@kody-ade/kody-chat-dashboard/routes/kody/apps-detail";
type Context = { params: Promise<{ slug: string }> };
export async function GET(req: NextRequest, ctx: Context) {
  const user = await requireKodyUser();
  return user instanceof NextResponse ? user : packageGET(req, ctx);
}
export async function PATCH(req: NextRequest, ctx: Context) {
  const user = await requireKodyUser();
  return user instanceof NextResponse ? user : packagePATCH(req, ctx);
}
export async function DELETE(req: NextRequest, ctx: Context) {
  const user = await requireKodyUser();
  return user instanceof NextResponse ? user : packageDELETE(req, ctx);
}
