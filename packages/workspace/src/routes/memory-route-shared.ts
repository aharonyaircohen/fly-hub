import {
  getRequestAuth,
  verifyRepoReadAccess,
  verifyRepoWriteAccess,
} from "@kody-ade/base/auth";
import { getKodyRequestUserProvider } from "@kody-ade/base/auth/request-user-provider";
import {
  MemoryAccessDeniedError,
  MemoryNotFoundError,
  type EvidenceRef,
} from "@kody-ade/memory";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createMemoryRuntime } from "../memory/runtime";

type AccessMode = "read" | "write";

export async function requestMemoryContext(
  request: NextRequest,
  mode: AccessMode,
) {
  const hostUser = await getKodyRequestUserProvider()?.resolveUser(request);
  const repository = getRequestAuth(request);
  if (!repository && hostUser) {
    return createMemoryRuntime({
      actor: { kind: "user", id: hostUser.id },
      tenantId: `user:${hostUser.id}`,
      includeRepositoryScope: false,
    });
  }
  const access =
    mode === "read"
      ? await verifyRepoReadAccess(request)
      : await verifyRepoWriteAccess(request);
  if (access instanceof NextResponse) return access;

  const tenantId = `${access.auth.owner}/${access.auth.repo}`;
  const runtime = createMemoryRuntime({
    actor: {
      kind: "user",
      id: hostUser?.id ?? `github:${access.actorGithubId}`,
    },
    tenantId,
  });
  return runtime;
}

export function userInputEvidence(): Readonly<EvidenceRef> {
  return Object.freeze({
    source: "user-input",
    id: `request-${crypto.randomUUID()}`,
  });
}

export function memoryErrorResponse(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: "validation_error", details: error.issues },
      { status: 400 },
    );
  }
  if (error instanceof MemoryNotFoundError) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (error instanceof MemoryAccessDeniedError) {
    return NextResponse.json(
      { error: "memory_access_denied" },
      { status: 403 },
    );
  }
  console.error(`[Memory] ${fallback}:`, error);
  return NextResponse.json(
    { error: "memory_request_failed", message: fallback },
    { status: 500 },
  );
}
