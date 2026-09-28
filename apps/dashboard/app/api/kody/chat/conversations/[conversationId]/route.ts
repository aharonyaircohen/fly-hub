import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  backendApi,
  getConvexClient,
} from "@dashboard/lib/backend/convex-backend";
import { logger } from "@kody-ade/base/logger";
import { invalidBody, requireConversationContext } from "../_shared";

const metadataSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    preview: z.string().trim().min(1).max(200).optional(),
    pinned: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.preview !== undefined ||
      value.pinned !== undefined,
    "At least one metadata field is required",
  );

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export async function GET(
  req: NextRequest,
  route: RouteContext,
): Promise<NextResponse> {
  const context = await requireConversationContext(req);
  if (context instanceof NextResponse) return context;
  const { conversationId } = await route.params;
  const result = await getConvexClient().query(backendApi.conversations.get, {
    tenantId: context.tenantId,
    conversationId,
  });
  if (!result) {
    return NextResponse.json(
      { error: "conversation_not_found" },
      { status: 404 },
    );
  }
  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PATCH(
  req: NextRequest,
  route: RouteContext,
): Promise<NextResponse> {
  const context = await requireConversationContext(req);
  if (context instanceof NextResponse) return context;
  const parsed = metadataSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.issues);
  const { conversationId } = await route.params;
  try {
    await getConvexClient().mutation(backendApi.conversations.updateMetadata, {
      tenantId: context.tenantId,
      conversationId,
      ...parsed.data,
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error({ error, conversationId }, "conversation update failed");
    return NextResponse.json(
      { error: "conversation_update_failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  route: RouteContext,
): Promise<NextResponse> {
  const context = await requireConversationContext(req);
  if (context instanceof NextResponse) return context;
  const { conversationId } = await route.params;
  try {
    await getConvexClient().mutation(backendApi.conversations.remove, {
      tenantId: context.tenantId,
      conversationId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error({ error, conversationId }, "conversation delete failed");
    return NextResponse.json(
      { error: "conversation_delete_failed" },
      { status: 500 },
    );
  }
}
