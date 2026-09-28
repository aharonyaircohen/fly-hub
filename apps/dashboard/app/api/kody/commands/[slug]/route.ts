import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BUILTIN_COMMANDS, isValidSlug } from "@kody-ade/workspace/commands";
import { getRequestAuth } from "@kody-ade/base/auth";
import {
  GET as getRepositoryCommand,
  PATCH as patchRepositoryCommand,
  DELETE as deleteRepositoryCommand,
} from "@kody-ade/workspace/routes/commands-slug";
import { resolveKodyRequestScope } from "@dashboard/lib/auth/kody-request-scope";
import {
  readPersonalCommand,
  removePersonalCommand,
  savePersonalCommand,
} from "@dashboard/lib/personal-documents";

const updateSchema = z.object({
  description: z.string().optional(),
  argumentHint: z.string().nullable().optional(),
  body: z.string().min(1).optional(),
});

function builtin(slug: string) {
  const command = BUILTIN_COMMANDS.find((item) => item.slug === slug);
  return command
    ? { ...command, argumentHint: command.argumentHint ?? "", source: "builtin" as const, sha: "", updatedAt: "", htmlUrl: "" }
    : null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const resolved = await resolveKodyRequestScope(req);
  if (resolved instanceof NextResponse) return resolved;
  if (getRequestAuth(req)) return getRepositoryCommand(req, { params });
  const { slug } = await params;
  if (!isValidSlug(slug)) return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
  const command = (await readPersonalCommand(resolved.personalTenantId, slug)) ?? builtin(slug);
  return command
    ? NextResponse.json({ command })
    : NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const resolved = await resolveKodyRequestScope(req);
  if (resolved instanceof NextResponse) return resolved;
  if (getRequestAuth(req)) return patchRepositoryCommand(req, { params });
  const { slug } = await params;
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!isValidSlug(slug) || !parsed.success) return NextResponse.json({ error: "validation_error" }, { status: 400 });
  const existing = (await readPersonalCommand(resolved.personalTenantId, slug)) ?? builtin(slug);
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const command = await savePersonalCommand(resolved.personalTenantId, {
    slug,
    description: parsed.data.description ?? existing.description,
    argumentHint: parsed.data.argumentHint === undefined ? existing.argumentHint : (parsed.data.argumentHint ?? ""),
    body: parsed.data.body ?? existing.body,
  });
  return NextResponse.json({ command });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const resolved = await resolveKodyRequestScope(req);
  if (resolved instanceof NextResponse) return resolved;
  if (getRequestAuth(req)) return deleteRepositoryCommand(req, { params });
  const { slug } = await params;
  if (!isValidSlug(slug)) return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
  const existing = await readPersonalCommand(resolved.personalTenantId, slug);
  if (!existing) return NextResponse.json({ error: "shared_readonly" }, { status: 405 });
  await removePersonalCommand(resolved.personalTenantId, slug);
  return NextResponse.json({ success: true });
}
