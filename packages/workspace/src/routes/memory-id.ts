import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  memoryErrorResponse,
  requestMemoryContext,
  userInputEvidence,
} from "./memory-route-shared";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const kindSchema = z.enum([
  "preference",
  "fact",
  "decision",
  "reference",
]);
const updateSchema = z
  .object({
    kind: kindSchema.optional(),
    title: z.string().trim().min(1).max(120).optional(),
    summary: z.string().trim().min(1).max(500).optional(),
    body: z.string().trim().min(1).max(20_000).optional(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine(
    (input) =>
      input.kind !== undefined ||
      input.title !== undefined ||
      input.summary !== undefined ||
      input.body !== undefined,
    { message: "At least one memory field must be provided." },
  );

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const context = await requestMemoryContext(req, "read");
  if (context instanceof NextResponse) return context;

  try {
    const { id } = await params;
    const memory = await context.application.get({
      principal: context.principal,
      memoryId: id,
    });
    const revisions = await context.application.history({
      principal: context.principal,
      memoryId: id,
    });
    return NextResponse.json(
      { memory, revisions },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return memoryErrorResponse(error, "Failed to fetch memory");
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const context = await requestMemoryContext(req, "write");
  if (context instanceof NextResponse) return context;

  try {
    const { id } = await params;
    const input = updateSchema.parse(await req.json());
    const current = await context.application.get({
      principal: context.principal,
      memoryId: id,
    });
    const memory = await context.application.correct({
      principal: context.principal,
      memoryId: id,
      kind: input.kind ?? current.kind,
      content: {
        title: input.title ?? current.content.title,
        summary: input.summary ?? current.content.summary,
        body: input.body ?? current.content.body,
      },
      evidence: [userInputEvidence()],
      reason: input.reason ?? "Updated manually by the user.",
    });
    return NextResponse.json({ memory }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return memoryErrorResponse(error, "Failed to update memory");
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const context = await requestMemoryContext(req, "write");
  if (context instanceof NextResponse) return context;

  try {
    const { id } = await params;
    await context.application.forget({
      principal: context.principal,
      memoryId: id,
    });
    return NextResponse.json(
      { deleted: true },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return memoryErrorResponse(error, "Failed to delete memory");
  }
}
