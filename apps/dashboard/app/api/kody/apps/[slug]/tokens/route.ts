import "@dashboard/lib/chat/personal-model-settings";
import { NextRequest, NextResponse } from "next/server";
import { requireKodyUser } from "@dashboard/lib/auth/kody-user";
import { POST as packagePOST } from "@kody-ade/kody-chat-dashboard/routes/kody/apps-tokens";
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const user = await requireKodyUser();
  return user instanceof NextResponse ? user : packagePOST(req, ctx);
}
