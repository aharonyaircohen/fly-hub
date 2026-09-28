import { NextRequest, NextResponse } from "next/server";
import {
  backendApi,
  getConvexClient,
} from "@dashboard/lib/backend/convex-backend";
import { requireConversationContext } from "../../_shared";

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set([
  "application/json",
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function allowedMediaType(value: string): boolean {
  return value.startsWith("text/") || ALLOWED_MEDIA_TYPES.has(value);
}

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export async function POST(
  req: NextRequest,
  route: RouteContext,
): Promise<NextResponse> {
  const context = await requireConversationContext(req);
  if (context instanceof NextResponse) return context;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (
    !(file instanceof File) ||
    file.size < 1 ||
    file.size > MAX_ATTACHMENT_BYTES ||
    !allowedMediaType(file.type)
  ) {
    return NextResponse.json({ error: "invalid_attachment" }, { status: 400 });
  }
  const { conversationId } = await route.params;
  const client = getConvexClient();
  const uploadUrl = await client.mutation(
    backendApi.conversations.createAttachmentUpload,
    { tenantId: context.tenantId, conversationId },
  );
  const upload = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!upload.ok) {
    return NextResponse.json(
      { error: "attachment_upload_failed" },
      { status: 502 },
    );
  }
  const { storageId } = (await upload.json()) as { storageId: string };
  const attachmentId = crypto.randomUUID();
  await client.mutation(backendApi.conversations.attachFile, {
    tenantId: context.tenantId,
    conversationId,
    attachment: {
      attachmentId,
      entryId: "pending",
      storageId,
      fileName: file.name.slice(0, 255),
      mediaType: file.type,
      sizeBytes: file.size,
      createdAt: new Date().toISOString(),
    },
  });
  return NextResponse.json(
    {
      id: attachmentId,
      name: file.name,
      mimeType: file.type,
      size: file.size,
    },
    { status: 201 },
  );
}
