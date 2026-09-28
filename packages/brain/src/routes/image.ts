/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-image-save-route
 *
 * POST /api/kody/brain/image starts an async full-image save.
 * GET /api/kody/brain/image?jobId=... polls it and records the GHCR ref.
 */
import { NextRequest, NextResponse } from "next/server";

import { startBrainImageSave } from "../image-save-command";
import {
  BrainImageManagementError,
  deleteBrainImageRef,
  pollBrainImageSave,
  readBrainImageManagement,
} from "../image-management";
import { logger } from "@kody-ade/base/logger";
import { resolvePersonalBrainContext } from "../personal-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function errorStatus(err: unknown, fallback = 502): number {
  return typeof (err as { status?: unknown }).status === "number"
    ? (err as { status: number }).status
    : fallback;
}

function errorCode(err: unknown, fallback: string): string {
  return typeof (err as { code?: unknown }).code === "string"
    ? (err as { code: string }).code
    : fallback;
}

function providerContextErrorBody(input: { error: string; message?: string }) {
  return {
    error: input.error,
    ...(input.message ? { message: input.message } : {}),
  };
}

export async function POST(req: NextRequest) {
  const ctx = await resolvePersonalBrainContext(req);
  if (!ctx.ok) {
    return NextResponse.json(providerContextErrorBody(ctx), {
      status: ctx.status,
    });
  }
  if (!ctx.context.flyToken) {
    return NextResponse.json(
      {
        error: "fly_token_missing",
        message: "Add FLY_API_TOKEN to Personal Credentials.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await startBrainImageSave({ context: ctx.context });
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { err, userId: ctx.context.userId },
      "brain image save start failed",
    );
    const status = errorStatus(err);
    const code = errorCode(err, "brain_image_save_start_failed");
    if (code === "fly_access_denied") {
      return NextResponse.json(
        {
          error: "fly_access_denied",
          message: "Fly token cannot access this Brain app.",
          app: (err as { app?: string }).app,
          org: (err as { org?: string }).org,
          reason: "fly_access_denied",
        },
        { status },
      );
    }
    if (code === "fly_bridge_access_denied") {
      return NextResponse.json(
        {
          error: "fly_bridge_access_denied",
          message,
          app: (err as { app?: string }).app,
          org: (err as { org?: string }).org,
          reason: "fly_bridge_access_denied",
        },
        { status },
      );
    }
    if (code === "brain_not_found") {
      return NextResponse.json(
        {
          error: "brain_not_found",
          message: "No Brain machine found to save.",
          reason: (err as { reason?: string }).reason,
        },
        { status },
      );
    }
    return NextResponse.json(
      { error: "brain_image_save_start_failed", message },
      { status },
    );
  }
}

export async function GET(req: NextRequest) {
  const ctx = await resolvePersonalBrainContext(req);
  if (!ctx.ok) {
    return NextResponse.json(providerContextErrorBody(ctx), {
      status: ctx.status,
    });
  }
  const requestedJobId = req.nextUrl.searchParams.get("jobId")?.trim();

  try {
    const result = requestedJobId
      ? await pollBrainImageSave({
          context: ctx.context,
          jobId: requestedJobId,
        })
      : await readBrainImageManagement({ context: ctx.context });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { err, userId: ctx.context.userId },
      "brain image save status failed",
    );
    if (err instanceof BrainImageManagementError) {
      if (err.code === "job_not_found") {
        return NextResponse.json(
          { error: "job_not_found", message },
          { status: err.status },
        );
      }
      if (err.code === "brain_image_save_failed") {
        return NextResponse.json(
          {
            ok: false,
            status: "failed",
            phase: "failed",
            message,
            ...err.details,
          },
          { status: err.status },
        );
      }
      return NextResponse.json(
        { error: err.code, message, ...err.details },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: "brain_image_save_status_failed", message },
      { status: 502 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await resolvePersonalBrainContext(req);
  if (!ctx.ok) {
    return NextResponse.json(providerContextErrorBody(ctx), {
      status: ctx.status,
    });
  }
  if (!ctx.context.flyToken) {
    return NextResponse.json(
      {
        error: "fly_token_missing",
        message: "Add FLY_API_TOKEN to Personal Credentials.",
      },
      { status: 400 },
    );
  }

  const imageRef = req.nextUrl.searchParams.get("imageRef")?.trim();
  if (!imageRef) {
    return NextResponse.json(
      { error: "image_ref_required", message: "Image ref is required." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(
      await deleteBrainImageRef({
        context: ctx.context,
        imageRef,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof BrainImageManagementError) {
      return NextResponse.json(
        { error: err.code, message },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: "brain_image_delete_failed", message },
      { status: 502 },
    );
  }
}
