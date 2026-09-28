import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  backendApi,
  getConvexClient,
} from "@dashboard/lib/backend/convex-backend";
import { logger } from "@kody-ade/base/logger";
import { invalidBody, requireConversationContext } from "../../_shared";
import { isRenderedViewDirective } from "@dashboard/lib/chat-ui-actions";

const agentSchema = z.object({
  slug: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(120),
});
const statusSchema = z.enum(["pending", "committed", "failed", "cancelled"]);
const runtimeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("direct"), modelId: z.string().min(1).max(200) }),
  z.object({ kind: z.literal("brain"), brainId: z.string().min(1).max(200) }),
  z.object({
    kind: z.literal("engine"),
    profileId: z.string().min(1).max(200),
  }),
  z.object({ kind: z.literal("live"), profileId: z.string().min(1).max(200) }),
]);
const commandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("append-message"),
    actorLogin: z.string().min(1).max(100),
    entryId: z.string().min(1).max(120),
    idempotencyKey: z.string().min(1).max(200),
    role: z.enum(["user", "assistant"]),
    agent: agentSchema.optional(),
    content: z.string().max(1_000_000),
    view: z.unknown().optional(),
    status: statusSchema,
    turnId: z.string().min(1).max(120),
    attachmentIds: z.array(z.string().min(1).max(300)).max(20).optional(),
    createdAt: z.string().datetime(),
  }),
  z.object({
    kind: z.literal("update-message"),
    actorLogin: z.string().min(1).max(100),
    entryId: z.string().min(1).max(120),
    content: z.string().max(1_000_000),
    view: z.unknown().optional(),
    status: statusSchema,
    updatedAt: z.string().datetime(),
  }),
  z.object({
    kind: z.literal("remove-message"),
    actorLogin: z.string().min(1).max(100),
    entryId: z.string().min(1).max(120),
  }),
  z.object({
    kind: z.literal("set-agent"),
    actorLogin: z.string().min(1).max(100),
    agent: agentSchema,
    updatedAt: z.string().datetime(),
  }),
  z.object({
    kind: z.literal("handoff"),
    actorLogin: z.string().min(1).max(100),
    entryId: z.string().min(1).max(120),
    idempotencyKey: z.string().min(1).max(200),
    from: agentSchema,
    to: agentSchema,
    createdAt: z.string().datetime(),
  }),
  z.object({
    kind: z.literal("runtime"),
    actorLogin: z.string().min(1).max(100),
    runtime: runtimeSchema,
    updatedAt: z.string().datetime(),
  }),
  z.object({
    kind: z.literal("machine-access"),
    actorLogin: z.string().min(1).max(100),
    machineAccess: z.enum(["none", "local", "brain"]),
    updatedAt: z.string().datetime(),
  }),
  z.object({
    kind: z.literal("checkpoint"),
    actorLogin: z.string().min(1).max(100),
    version: z.number().int().positive(),
    throughSeq: z.number().int().nonnegative(),
    agentEpochId: z.string().min(1).max(120),
    summary: z.string().min(1).max(200_000),
    sourceHash: z.string().min(1).max(200),
    createdAt: z.string().datetime(),
  }),
  z.object({
    kind: z.literal("clear"),
    actorLogin: z.string().min(1).max(100),
  }),
]);

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export async function POST(
  req: NextRequest,
  route: RouteContext,
): Promise<NextResponse> {
  const context = await requireConversationContext(req);
  if (context instanceof NextResponse) return context;
  const parsed = commandSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.issues);
  if (
    (parsed.data.kind === "append-message" ||
      parsed.data.kind === "update-message") &&
    parsed.data.view !== undefined &&
    !isRenderedViewDirective(parsed.data.view)
  ) {
    return invalidBody("Invalid rendered view");
  }
  const { conversationId } = await route.params;
  const client = getConvexClient();

  try {
    switch (parsed.data.kind) {
      case "append-message": {
        if (parsed.data.role === "assistant" && !parsed.data.agent) {
          return invalidBody("Assistant messages require an agent");
        }
        await client.mutation(backendApi.conversations.appendEntry, {
          tenantId: context.tenantId,
          conversationId,
          entryId: parsed.data.entryId,
          idempotencyKey: parsed.data.idempotencyKey,
          entry: {
            kind: "message",
            role: parsed.data.role,
            author:
              parsed.data.role === "user"
                ? {
                    kind: "user",
                    actorId: `kody:${context.actorId}`,
                  }
                : { kind: "agent", ...parsed.data.agent! },
            content: parsed.data.content,
            view: parsed.data.view,
            status: parsed.data.status,
            turnId: parsed.data.turnId,
            attachmentIds: parsed.data.attachmentIds,
            createdAt: parsed.data.createdAt,
          },
        });
        break;
      }
      case "update-message":
        await client.mutation(backendApi.conversations.updateMessage, {
          tenantId: context.tenantId,
          conversationId,
          entryId: parsed.data.entryId,
          content: parsed.data.content,
          view: parsed.data.view,
          status: parsed.data.status,
          updatedAt: parsed.data.updatedAt,
        });
        break;
      case "remove-message":
        await client.mutation(backendApi.conversations.removeMessage, {
          tenantId: context.tenantId,
          conversationId,
          entryId: parsed.data.entryId,
        });
        break;
      case "handoff":
        await client.mutation(backendApi.conversations.appendEntry, {
          tenantId: context.tenantId,
          conversationId,
          entryId: parsed.data.entryId,
          idempotencyKey: parsed.data.idempotencyKey,
          entry: {
            kind: "agent-handoff",
            from: parsed.data.from,
            to: parsed.data.to,
            createdAt: parsed.data.createdAt,
          },
        });
        break;
      case "set-agent":
        await client.mutation(backendApi.conversations.setInitialAgent, {
          tenantId: context.tenantId,
          conversationId,
          activeAgent: parsed.data.agent,
          updatedAt: parsed.data.updatedAt,
        });
        break;
      case "runtime":
        await client.mutation(backendApi.conversations.updateRuntime, {
          tenantId: context.tenantId,
          conversationId,
          runtime: parsed.data.runtime,
          updatedAt: parsed.data.updatedAt,
        });
        break;
      case "machine-access":
        await client.mutation(backendApi.conversations.updateMachineAccess, {
          tenantId: context.tenantId,
          conversationId,
          machineAccess: parsed.data.machineAccess,
          updatedAt: parsed.data.updatedAt,
        });
        break;
      case "checkpoint":
        await client.mutation(backendApi.conversations.saveCheckpoint, {
          tenantId: context.tenantId,
          conversationId,
          version: parsed.data.version,
          throughSeq: parsed.data.throughSeq,
          agentEpochId: parsed.data.agentEpochId,
          summary: parsed.data.summary,
          sourceHash: parsed.data.sourceHash,
          createdAt: parsed.data.createdAt,
        });
        break;
      case "clear":
        await client.mutation(backendApi.conversations.clear, {
          tenantId: context.tenantId,
          conversationId,
        });
        break;
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error(
      { error, conversationId, command: parsed.data.kind },
      "conversation command failed",
    );
    return NextResponse.json(
      { error: "conversation_command_failed" },
      { status: 500 },
    );
  }
}
