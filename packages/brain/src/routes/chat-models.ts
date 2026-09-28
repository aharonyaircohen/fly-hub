import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolvePersonalBrainContext } from "../personal-context";
import {
  BrainChatModelsSchema,
  normalizeBrainChatModels,
} from "../chat-models";
import { readBrainChatModels, writeBrainChatModels } from "../chat-model-store";

const PutSchema = z.object({ models: BrainChatModelsSchema });

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function contextFor(req: NextRequest) {
  const ctx = await resolvePersonalBrainContext();
  if (!ctx.ok) {
    return {
      response: NextResponse.json({ error: ctx.error }, { status: ctx.status }),
    } as const;
  }
  return { ctx } as const;
}

export async function GET(req: NextRequest) {
  const result = await contextFor(req);
  if ("response" in result) return result.response;
  const models = await readBrainChatModels(result.ctx.context.account);
  return NextResponse.json(
    { models },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(req: NextRequest) {
  const result = await contextFor(req);
  if ("response" in result) return result.response;
  const body = await req.json().catch(() => null);
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }
  const models = await writeBrainChatModels(
    result.ctx.context.account,
    normalizeBrainChatModels(parsed.data.models),
  );
  return NextResponse.json({ ok: true, models });
}
