/**
 * @fileType api-endpoint
 * @domain widgets
 * @pattern widget-bundle-serving
 * @ai-summary Widget bundle API — thin re-export of the package-owned
 *   handler (@kody-ade/kody-chat-dashboard).
 */
import "@dashboard/lib/chat/personal-model-settings";
import { NextRequest, NextResponse } from "next/server";
import { requireKodyUser } from "@dashboard/lib/auth/kody-user";
import {
  DELETE as packageDELETE,
  GET as packageGET,
} from "@kody-ade/kody-chat-dashboard/routes/kody/widgets-detail";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const user = await requireKodyUser();
  return user instanceof NextResponse ? user : packageGET(req, context);
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const user = await requireKodyUser();
  return user instanceof NextResponse ? user : packageDELETE(req, context);
}
