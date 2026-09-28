import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { applyBrainImage } from "@kody-ade/brain/image-apply-command";
import { failBrainRuntimeApply } from "@kody-ade/brain/runtime-manager";
import { secureRequestOrigin } from "@kody-ade/base/request-origin";
import { decrypt } from "@kody-ade/base/vault/crypto";
import { resolvePersonalBrainContextForUser } from "@dashboard/lib/brain/personal-context";
import { withPersonalBrainUser } from "@dashboard/lib/brain/personal-services";
import { shouldFinalizeBrainRestoreFailure } from "@dashboard/lib/brain/restore-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

function validServiceKey(req: NextRequest): boolean {
  const expected = process.env.KODY_SERVICE_KEY?.trim() ?? "";
  const supplied =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !supplied) return false;
  return timingSafeEqual(
    createHash("sha256").update(expected).digest(),
    createHash("sha256").update(supplied).digest(),
  );
}

export async function POST(req: NextRequest) {
  if (!validServiceKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  const operationId =
    typeof body?.operationId === "string" ? body.operationId.trim() : "";
  const imageRef =
    typeof body?.imageRef === "string" ? body.imageRef.trim() : "";
  const githubAccount =
    typeof body?.githubAccount === "string" ? body.githubAccount.trim() : "";
  const githubOwner =
    typeof body?.githubOwner === "string" ? body.githubOwner.trim() : "";
  const githubTokenEncrypted =
    typeof body?.githubTokenEncrypted === "string"
      ? body.githubTokenEncrypted.trim()
      : "";
  const finalAttempt = body?.finalAttempt === true;
  if (!userId || !operationId || !imageRef) {
    return NextResponse.json({ error: "Invalid restore job" }, { status: 400 });
  }
  return withPersonalBrainUser(userId, async () => {
    const resolved = await resolvePersonalBrainContextForUser(userId, req);
    if (!resolved.ok) {
      return NextResponse.json(
        { error: resolved.error },
        { status: resolved.status },
      );
    }
    try {
      const githubToken = githubTokenEncrypted
        ? decrypt(githubTokenEncrypted)
        : resolved.context.githubToken;
      await applyBrainImage({
        context: {
          ...resolved.context,
          githubToken,
          ...(githubAccount ? { githubAccount } : {}),
          ...(githubOwner ? { githubOwner } : {}),
        },
        dashboardUrl: secureRequestOrigin(req),
        imageRef,
        reset: body?.reset === true,
        operationId,
      });
      return NextResponse.json({ ok: true, operationId });
    } catch (error) {
      const status = (error as { status?: number }).status ?? 502;
      if (shouldFinalizeBrainRestoreFailure(status, finalAttempt)) {
        await failBrainRuntimeApply(
          resolved.context.account,
          resolved.context.githubToken,
          imageRef,
          error instanceof Error ? error.message : String(error),
          operationId,
        ).catch(() => undefined);
      }
      return NextResponse.json(
        {
          error: (error as { code?: string }).code ?? "brain_restore_failed",
          message: error instanceof Error ? error.message : String(error),
        },
        { status },
      );
    }
  });
}
