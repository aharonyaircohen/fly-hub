import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPersonalBrainServices } from "@kody-ade/brain/personal-services";
import { isInternalKodyCredential } from "@kody-ade/base/auth/internal-credentials";
import { readVault } from "@kody-ade/base/vault/store";
import {
  requireBrainAgent,
  requireAgentRepository,
  agentError,
  privateHeaders,
} from "@dashboard/lib/brain/agent-access";

export const dynamic = "force-dynamic";
const inputSchema = z
  .object({
    names: z
      .array(z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/))
      .min(1)
      .max(32),
    repository: z.string().max(200).optional(),
  })
  .strict();
const serverOnly = new Set([
  "KODY_MASTER_KEY",
  "KODY_SERVICE_KEY",
  "CONVEX_ADMIN_KEY",
  "CONVEX_DEPLOY_KEY",
]);

export async function POST(req: NextRequest) {
  try {
    const identity = await requireBrainAgent(req);
    if (identity instanceof NextResponse) return identity;
    const raw = await req.text();
    if (Buffer.byteLength(raw) > 8192)
      return agentError("request_too_large", 413);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return agentError("invalid_request", 400);
    }
    const input = inputSchema.safeParse(body);
    if (!input.success) return agentError("invalid_request", 400);
    if (
      input.data.names.some(
        (name) => isInternalKodyCredential(name) || serverOnly.has(name),
      )
    )
      return agentError("credential_not_available", 403);
    const values: Record<string, string> = {};
    if (input.data.repository) {
      const access = await requireAgentRepository(
        req,
        identity.userId,
        input.data.repository,
      );
      if (access instanceof NextResponse) return access;
      const { doc } = await readVault(
        access.octokit,
        access.auth.owner,
        access.auth.repo,
      );
      for (const name of input.data.names) {
        const value = doc.secrets[name]?.value;
        if (value) values[name] = value;
      }
    } else {
      for (const name of input.data.names) {
        const value = await getPersonalBrainServices().getCredential(
          identity.userId,
          name,
        );
        if (value) values[name] = value;
      }
    }
    if (input.data.names.some((name) => !(name in values)))
      return agentError("credential_not_found", 404);
    return NextResponse.json({ values }, { headers: privateHeaders });
  } catch {
    return agentError("credential_access_unavailable", 503);
  }
}
