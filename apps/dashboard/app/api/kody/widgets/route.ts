/**
 * @fileType api-endpoint
 * @domain widgets
 * @pattern backend-crud-api
 * @ai-summary Widgets admin API (list + publish) — thin re-export of the
 *   package-owned handlers (@kody-ade/kody-chat-dashboard).
 */
import "@dashboard/lib/chat/personal-model-settings";
import { NextRequest, NextResponse } from "next/server";
import { requireKodyUser } from "@dashboard/lib/auth/kody-user";
import {
  GET as packageGET,
  POST as packagePOST,
} from "@kody-ade/kody-chat-dashboard/routes/kody/widgets";

export async function GET(req: NextRequest) {
  const user = await requireKodyUser();
  return user instanceof NextResponse ? user : packageGET(req);
}

export async function POST(req: NextRequest) {
  const user = await requireKodyUser();
  return user instanceof NextResponse ? user : packagePOST(req);
}
