import { NextResponse } from "next/server";
import { z } from "zod";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import {
  bearerToken,
  verifyGitHubWorkflowIdentity,
} from "@dashboard/lib/backend/github-actions-identity";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const requestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
}).strict();

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
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const connection = await createBackendClient().query(backendApi.connections.get, {
    tenantId: identity.repository,
    connectionId: parsed.data.id,
  });
  if (!connection) {
    return NextResponse.json(
      { error: "connection_not_found" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json({ connection }, { headers: NO_STORE_HEADERS });
}
