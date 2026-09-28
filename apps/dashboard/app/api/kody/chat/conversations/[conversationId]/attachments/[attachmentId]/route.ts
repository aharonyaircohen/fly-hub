import { NextRequest, NextResponse } from "next/server";
import {
  backendApi,
  getConvexClient,
} from "@dashboard/lib/backend/convex-backend";
import { requireConversationContext } from "../../../_shared";

type RouteContext = {
  params: Promise<{ conversationId: string; attachmentId: string }>;
};

export async function GET(
  req: NextRequest,
  route: RouteContext,
): Promise<NextResponse> {
  const context = await requireConversationContext(req);
  if (context instanceof NextResponse) return context;
  const { conversationId, attachmentId } = await route.params;
  const url = await getConvexClient().query(
    backendApi.conversations.getAttachmentUrl,
    { tenantId: context.tenantId, conversationId, attachmentId },
  );
  if (!url) {
    return NextResponse.json(
      { error: "attachment_not_found" },
      { status: 404 },
    );
  }
  const stored = await fetch(url);
  if (!stored.ok) {
    return NextResponse.json(
      { error: "attachment_read_failed" },
      { status: 502 },
    );
  }
  return new NextResponse(stored.body, {
    headers: {
      "Content-Type":
        stored.headers.get("Content-Type") ?? "application/octet-stream",
      "Cache-Control": "private, max-age=300",
    },
  });
}

export async function DELETE(
  req: NextRequest,
  route: RouteContext,
): Promise<NextResponse> {
  const context = await requireConversationContext(req);
  if (context instanceof NextResponse) return context;
  const { conversationId, attachmentId } = await route.params;
  await getConvexClient().mutation(backendApi.conversations.removeAttachment, {
    tenantId: context.tenantId,
    conversationId,
    attachmentId,
  });
  return NextResponse.json({ ok: true });
}
