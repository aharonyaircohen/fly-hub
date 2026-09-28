import { NextResponse } from "next/server";
import { z } from "zod";

import {
  bearerToken,
  verifyGitHubWorkflowIdentity,
} from "@dashboard/lib/backend/github-actions-identity";
import { memoryErrorResponse } from "@kody-ade/workspace/routes/memory-route-shared";
import { createMemoryRuntime } from "@kody-ade/workspace/memory/runtime";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const memoryId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,127}$/);
const kind = z.enum(["preference", "fact", "decision", "reference"]);
const runId = z.string().trim().min(1).max(256);
const contentFields = {
  title: z.string().trim().min(3).max(120),
  summary: z.string().trim().min(10).max(500),
  body: z.string().trim().min(10).max(20_000),
};
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }).strict(),
  z
    .object({
      action: z.literal("search"),
      query: z.string().trim().min(1).max(500),
      limit: z.number().int().min(1).max(20).default(10),
    })
    .strict(),
  z
    .object({
      action: z.literal("get"),
      memoryId,
    })
    .strict(),
  z
    .object({
      action: z.literal("history"),
      memoryId,
    })
    .strict(),
  z
    .object({
      action: z.literal("remember"),
      kind,
      ...contentFields,
      runId,
      reason: z.string().trim().min(10).max(500),
    })
    .strict(),
  z
    .object({
      action: z.literal("update"),
      memoryId,
      kind: kind.optional(),
      title: contentFields.title.optional(),
      summary: contentFields.summary.optional(),
      body: contentFields.body.optional(),
      runId,
      reason: z.string().trim().min(10).max(500),
    })
    .strict()
    .refine(
      (input) =>
        input.kind !== undefined ||
        input.title !== undefined ||
        input.summary !== undefined ||
        input.body !== undefined,
      { message: "An update must change at least one memory field" },
    ),
]);

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json(
      { error: "missing_workflow_identity" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  let identity;
  try {
    identity = await verifyGitHubWorkflowIdentity(token);
  } catch {
    return NextResponse.json(
      { error: "invalid_workflow_identity" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.issues },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const tenantId = identity.repository;
  const runtime = createMemoryRuntime({
    actor: {
      kind: "engine",
      id: `github-actions:${identity.runId ?? identity.actor ?? "unknown"}`,
    },
    tenantId,
  });
  const scope = { kind: "repository" as const, tenantId };
  const command = parsed.data;

  try {
    if (command.action === "list") {
      const memories = await runtime.application.list({
        principal: runtime.principal,
        scopes: [scope],
      });
      return NextResponse.json({ memories }, { headers: NO_STORE_HEADERS });
    }
    if (command.action === "search") {
      const memories = await runtime.application.search({
        principal: runtime.principal,
        scopes: [scope],
        query: command.query,
        limit: command.limit,
      });
      return NextResponse.json({ memories }, { headers: NO_STORE_HEADERS });
    }
    if (command.action === "get") {
      const memory = await runtime.application.get({
        principal: runtime.principal,
        memoryId: command.memoryId,
      });
      return NextResponse.json({ memory }, { headers: NO_STORE_HEADERS });
    }
    if (command.action === "history") {
      const revisions = await runtime.application.history({
        principal: runtime.principal,
        memoryId: command.memoryId,
      });
      return NextResponse.json({ revisions }, { headers: NO_STORE_HEADERS });
    }
    if (command.action === "remember") {
      const memory = await runtime.application.remember({
        principal: runtime.principal,
        scope,
        kind: command.kind,
        content: {
          title: command.title,
          summary: command.summary,
          body: command.body,
        },
        evidence: [{ source: "engine-run", id: command.runId }],
        reason: command.reason,
      });
      return NextResponse.json(
        { memory },
        { status: 201, headers: NO_STORE_HEADERS },
      );
    }

    const current = await runtime.application.get({
      principal: runtime.principal,
      memoryId: command.memoryId,
    });
    const memory = await runtime.application.correct({
      principal: runtime.principal,
      memoryId: command.memoryId,
      kind: command.kind ?? current.kind,
      content: {
        title: command.title ?? current.content.title,
        summary: command.summary ?? current.content.summary,
        body: command.body ?? current.content.body,
      },
      evidence: [{ source: "engine-run", id: command.runId }],
      reason: command.reason,
    });
    return NextResponse.json({ memory }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return memoryErrorResponse(error, "Engine memory request failed");
  }
}
