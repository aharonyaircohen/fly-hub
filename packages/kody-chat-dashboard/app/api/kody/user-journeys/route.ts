import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { getRequestAuth, requireKodyAuth } from "@kody-ade/base/auth";
import {
  journeyDefinitionSchema,
  journeyStatusFromRuns,
} from "../../../../src/dashboard/lib/user-journeys/contracts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const saveSchema = z.object({
  action: z.literal("save"),
  definition: journeyDefinitionSchema,
});

const runSchema = z.object({
  action: z.literal("run"),
  journeyId: z.string().min(1).max(80),
  environment: z.enum(["local", "preview", "staging"]),
});

type JourneyRow = {
  tenantId: string;
  journeyId: string;
  name: string;
  goal: string;
  status: "draft" | "active" | "archived";
  priority: "critical" | "high" | "normal";
  currentVersion: number;
  updatedAt: string;
};

type RunRow = {
  runId: string;
  version: number;
  status: "queued" | "running" | "passed" | "failed" | "cancelled";
  environment: string;
  commitSha?: string;
  createdAt: string;
  updatedAt: string;
};

const headers = { "Cache-Control": "no-store, max-age=0" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers });
}

function context(req: NextRequest) {
  const auth = getRequestAuth(req);
  if (!auth) return null;
  return { auth, tenantId: `${auth.owner}/${auth.repo}` };
}

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  const current = context(req);
  if (!current) return json({ error: "missing_repo_context" }, 400);

  try {
    const client = createBackendClient();
    const rows = (await client.query(backendApi.userJourneys.list, {
      tenantId: current.tenantId,
    })) as JourneyRow[];
    const journeys = await Promise.all(
      rows.map(async (journey) => {
        const runs = (await client.query(backendApi.userJourneys.listRuns, {
          tenantId: current.tenantId,
          journeyId: journey.journeyId,
        })) as RunRow[];
        return {
          ...journey,
          health: journeyStatusFromRuns(runs),
          latestRun: runs[0] ?? null,
        };
      }),
    );
    return json({ journeys });
  } catch (error) {
    console.error("[UserJourneys] list failed", error);
    return json({ error: "user_journeys_unavailable" }, 500);
  }
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  const current = context(req);
  if (!current) return json({ error: "missing_repo_context" }, 400);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const parsed =
    (body as { action?: unknown } | null)?.action === "save"
      ? saveSchema.safeParse(body)
      : runSchema.safeParse(body);
  if (!parsed.success) return json({ error: "validation_error", details: parsed.error.issues }, 400);

  const client = createBackendClient();
  try {
    if (parsed.data.action === "save") {
      const definition = parsed.data.definition;
      const result = await client.mutation(backendApi.userJourneys.save, {
        tenantId: current.tenantId,
        journeyId: definition.id,
        name: definition.name,
        goal: definition.goal,
        status: definition.status,
        priority: definition.priority,
        definition,
        updatedAt: new Date().toISOString(),
      });
      return json({ result }, 201);
    }

    const journey = await client.query(backendApi.userJourneys.get, {
      tenantId: current.tenantId,
      journeyId: parsed.data.journeyId,
    });
    if (!journey) return json({ error: "user_journey_not_found" }, 404);

    const runId = randomUUID();
    await client.mutation(backendApi.userJourneys.createRun, {
      tenantId: current.tenantId,
      journeyId: parsed.data.journeyId,
      runId,
      version: journey.journey.currentVersion,
      environment: parsed.data.environment,
      createdAt: new Date().toISOString(),
    });
    return json({ runId, status: "queued" }, 201);
  } catch (error) {
    console.error("[UserJourneys] mutation failed", error);
    return json({ error: "user_journey_operation_failed" }, 500);
  }
}
