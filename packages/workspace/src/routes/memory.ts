import { MemoryAccessDeniedError } from "@kody-ade/memory";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  memoryErrorResponse,
  requestMemoryContext,
  userInputEvidence,
} from "./memory-route-shared";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const kindSchema = z.enum(["preference", "fact", "decision", "reference"]);
const createSchema = z.object({
  scope: z.enum(["user", "repository"]),
  kind: kindSchema,
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(20_000),
  reason: z.string().trim().min(1).max(500).optional(),
  expiresAt: z.iso.datetime().optional(),
});

export async function GET(req: NextRequest) {
  const context = await requestMemoryContext(req, "read");
  if (context instanceof NextResponse) return context;

  try {
    const requestedScope = req.nextUrl.searchParams.get("scope");
    const scopes =
      requestedScope === "user"
        ? context.scopes.filter((scope) => scope.kind === "user")
        : requestedScope === "repository"
          ? context.scopes.filter((scope) => scope.kind === "repository")
          : context.scopes;
    const memories = await context.application.list({
      principal: context.principal,
      scopes,
    });
    return NextResponse.json({ memories }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return memoryErrorResponse(error, "Failed to list memories");
  }
}

export async function POST(req: NextRequest) {
  const context = await requestMemoryContext(req, "write");
  if (context instanceof NextResponse) return context;

  try {
    const input = createSchema.parse(await req.json());
    const memory = await context.application.remember({
      principal: context.principal,
      scope:
        input.scope === "user"
          ? { kind: "user", userId: context.principal.actor.id }
          : { kind: "repository", tenantId: context.tenantId },
      kind: input.kind,
      content: {
        title: input.title,
        summary: input.summary,
        body: input.body,
      },
      evidence: [userInputEvidence()],
      reason: input.reason ?? "Created manually by the user.",
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    });
    return NextResponse.json(
      { memory },
      { status: 201, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof MemoryAccessDeniedError) {
      return NextResponse.json(
        { error: "memory_access_denied" },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }
    return memoryErrorResponse(error, "Failed to create memory");
  }
}
