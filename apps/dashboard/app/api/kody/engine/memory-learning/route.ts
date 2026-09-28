import { NextResponse } from "next/server";
import { z } from "zod";

import {
  bearerToken,
  verifyGitHubWorkflowIdentity,
} from "@dashboard/lib/backend/github-actions-identity";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const LEASE_DURATION_MS = 15 * 60_000;
const sourceRunId = z.string().trim().min(1).max(256);
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim") }).strict(),
  z
    .object({
      action: z.literal("complete"),
      sourceRunId,
    })
    .strict(),
  z
    .object({
      action: z.literal("fail"),
      sourceRunId,
      failure: z.string().trim().min(1).max(1_000),
    })
    .strict(),
  z
    .object({
      action: z.literal("recent-evidence"),
      limit: z.number().int().min(1).max(50).default(20),
    })
    .strict(),
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

  const actor = {
    kind: "engine" as const,
    id: `github-actions:${identity.runId ?? identity.actor ?? "unknown"}`,
  };
  const tenantId = identity.repository;
  const command = parsed.data;
  const client = createBackendClient();

  try {
    if (command.action === "claim") {
      const now = new Date();
      const result = await client.mutation(
        backendApi.memoryLearning.claimNext,
        {
          actor,
          tenantId,
          now: now.toISOString(),
          leaseUntil: new Date(now.getTime() + LEASE_DURATION_MS).toISOString(),
        },
      );
      return NextResponse.json(result, { headers: NO_STORE_HEADERS });
    }

    if (command.action === "complete") {
      const completed = await client.mutation(
        backendApi.memoryLearning.complete,
        {
          actor,
          tenantId,
          sourceRunId: command.sourceRunId,
          now: new Date().toISOString(),
        },
      );
      return NextResponse.json({ completed }, { headers: NO_STORE_HEADERS });
    }

    if (command.action === "fail") {
      const failed = await client.mutation(backendApi.memoryLearning.fail, {
        actor,
        tenantId,
        sourceRunId: command.sourceRunId,
        now: new Date().toISOString(),
        failure: command.failure,
      });
      return NextResponse.json({ failed }, { headers: NO_STORE_HEADERS });
    }

    const evidence = await client.query(
      backendApi.memoryLearning.recentEvidence,
      {
        actor,
        tenantId,
        limit: command.limit,
      },
    );
    return NextResponse.json({ evidence }, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json(
      { error: "memory_learning_backend_failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
