import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveKodyRequestScope } from "@dashboard/lib/auth/kody-request-scope";
import { getRequestAuth } from "@kody-ade/base/auth";
import {
  GET as getRepositoryInstructions,
  PUT as putRepositoryInstructions,
  DELETE as deleteRepositoryInstructions,
} from "@kody-ade/workspace/routes/instructions";
import {
  readPersonalInstructions,
  removePersonalInstructions,
  savePersonalInstructions,
} from "@dashboard/lib/personal-documents";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const schema = z.object({ body: z.string().max(20_000) });

export async function GET(req: NextRequest) {
  const resolved = await resolveKodyRequestScope(req);
  if (resolved instanceof NextResponse) return resolved;
  if (getRequestAuth(req)) return getRepositoryInstructions(req);
  return NextResponse.json(
    { instructions: await readPersonalInstructions(resolved.personalTenantId) },
    { headers: NO_STORE_HEADERS },
  );
}

export async function PUT(req: NextRequest) {
  const resolved = await resolveKodyRequestScope(req);
  if (resolved instanceof NextResponse) return resolved;
  if (getRequestAuth(req)) return putRepositoryInstructions(req);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_error" }, { status: 400 });
  }
  if (!parsed.data.body.trim()) {
    await removePersonalInstructions(resolved.personalTenantId);
    return NextResponse.json({ instructions: null });
  }
  return NextResponse.json({
    instructions: await savePersonalInstructions(
      resolved.personalTenantId,
      parsed.data.body,
    ),
  });
}

export async function DELETE(req: NextRequest) {
  const resolved = await resolveKodyRequestScope(req);
  if (resolved instanceof NextResponse) return resolved;
  if (getRequestAuth(req)) return deleteRepositoryInstructions(req);
  await removePersonalInstructions(resolved.personalTenantId);
  return NextResponse.json({ instructions: null });
}
