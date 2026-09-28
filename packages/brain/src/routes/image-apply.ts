/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-image-apply-route
 *
 * POST /api/kody/brain/image/apply applies the selected Brain image to the
 * user's Fly Brain. Selection remains metadata-only; this route owns runtime
 * mutation.
 */
import { after, NextRequest, NextResponse } from "next/server";

import { applyBrainImage } from "../image-apply-command";
import { logger } from "@kody-ade/base/logger";
import { resolvePersonalBrainContext } from "../personal-context";
import {
  requestOrigin,
  secureRequestOrigin,
} from "@kody-ade/base/request-origin";
import { getPersonalBrainServices } from "../personal-services";
import { beginBrainRuntimeApply, failBrainRuntimeApply } from "../runtime-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ApplyBody {
  imageRef?: string;
  reset?: boolean;
}

function isLocalOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const ctx = await resolvePersonalBrainContext(req);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  if (!ctx.context.flyToken) {
    return NextResponse.json(
      {
        error:
          "Brain image apply needs a Fly token. Add FLY_API_TOKEN to Personal Credentials.",
      },
      { status: 400 },
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as ApplyBody;
    const imageRef = body.imageRef?.trim();
    if (!imageRef) {
      return NextResponse.json(
        { error: "image_ref_required", message: "Image ref is required." },
        { status: 400 },
      );
    }

    const requestUrl = requestOrigin(req);
    const dashboardUrl = secureRequestOrigin(req);
    const started = await beginBrainRuntimeApply(
      ctx.context.account,
      ctx.context.githubToken,
      imageRef,
    );
    const operationId = started.operation?.id;
    if (!operationId) throw new Error("Brain restore operation was not created");
    if (isLocalOrigin(requestUrl)) {
      const work = () =>
        applyBrainImage({
          context: ctx.context,
          dashboardUrl,
          imageRef,
          reset: body.reset === true,
          operationId,
        }).catch((err) => {
          logger.error(
            { err, userId: ctx.context.userId, imageRef },
            "local Brain image restore failed in background",
          );
        });
      try {
        after(work);
      } catch {
        void work();
      }
    } else {
      const enqueue = getPersonalBrainServices().enqueueRestore;
      if (!enqueue) {
        await failBrainRuntimeApply(
          ctx.context.account,
          ctx.context.githubToken,
          imageRef,
          "Brain restore worker is not configured",
          operationId,
        ).catch(() => undefined);
        throw new Error("Brain restore worker is not configured");
      }
      try {
        await enqueue({
          userId: ctx.context.userId,
          githubAccount: ctx.context.githubAccount ?? "",
          ...(ctx.context.githubOwner
            ? { githubOwner: ctx.context.githubOwner }
            : {}),
          githubToken: ctx.context.githubToken,
          operationId,
          imageRef,
          reset: body.reset === true,
          dashboardUrl,
        });
      } catch (err) {
        await failBrainRuntimeApply(
          ctx.context.account,
          ctx.context.githubToken,
          imageRef,
          err instanceof Error ? err.message : String(err),
          operationId,
        ).catch(() => undefined);
        throw err;
      }
    }

    return NextResponse.json(
      {
        ok: true,
        status: "running",
        imageRef,
        operationId,
        message: "Brain image restore started.",
      },
      { status: 202 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { err, userId: ctx.context.userId },
      "brain image apply failed",
    );
    return NextResponse.json(
      {
        error: (err as { code?: string }).code ?? "brain_image_apply_failed",
        message,
      },
      { status: (err as { status?: number }).status ?? 502 },
    );
  }
}
