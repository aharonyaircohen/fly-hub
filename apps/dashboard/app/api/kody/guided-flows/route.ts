/**
 * Dashboard host adapter for the package-owned GuidedFlow API.
 * The chat package owns the contract; each host must expose the route where
 * the shared KodyChat component makes its requests.
 */
import "@dashboard/lib/chat/personal-model-settings";
import { NextRequest, NextResponse } from "next/server";
import { requireKodyUser } from "@dashboard/lib/auth/kody-user";
import {
  GET as packageGET,
  POST as packagePOST,
} from "@kody-ade/kody-chat-dashboard/routes/guided-flows";

export async function GET(req: NextRequest) {
  const user = await requireKodyUser();
  return user instanceof NextResponse ? user : packageGET(req);
}

export async function POST(req: NextRequest) {
  const user = await requireKodyUser();
  return user instanceof NextResponse ? user : packagePOST(req);
}
