import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isValidSlug } from "@kody-ade/workspace/commands";
import { getRequestAuth } from "@kody-ade/base/auth";
import {
  GET as getRepositoryCommands,
  POST as postRepositoryCommand,
} from "@kody-ade/workspace/routes/commands";
import { resolveKodyRequestScope } from "@dashboard/lib/auth/kody-request-scope";
import {
  listPersonalCommands,
  readPersonalCommand,
  savePersonalCommand,
} from "@dashboard/lib/personal-documents";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const schema = z.object({
  slug: z.string().min(1).max(64),
  description: z.string().default(""),
  argumentHint: z.string().optional(),
  body: z.string().min(1),
});

export async function GET(req: NextRequest) {
  const resolved = await resolveKodyRequestScope(req);
  if (resolved instanceof NextResponse) return resolved;
  if (getRequestAuth(req)) return getRepositoryCommands(req);
  const personal = await listPersonalCommands(resolved.personalTenantId);
  return NextResponse.json(
    {
      commands: personal.sort((a, b) =>
        a.slug.localeCompare(b.slug),
      ),
    },
    { headers: NO_STORE_HEADERS },
  );
}

export async function POST(req: NextRequest) {
  const resolved = await resolveKodyRequestScope(req);
  if (resolved instanceof NextResponse) return resolved;
  if (getRequestAuth(req)) return postRepositoryCommand(req);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isValidSlug(parsed.data?.slug ?? "")) {
    return NextResponse.json({ error: "validation_error" }, { status: 400 });
  }
  if (await readPersonalCommand(resolved.personalTenantId, parsed.data.slug)) {
    return NextResponse.json({ error: "slug_taken" }, { status: 409 });
  }
  const command = await savePersonalCommand(resolved.personalTenantId, {
    slug: parsed.data.slug,
    description: parsed.data.description,
    argumentHint: parsed.data.argumentHint ?? "",
    body: parsed.data.body,
  });
  return NextResponse.json({ command });
}
