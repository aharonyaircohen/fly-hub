/**
 * @fileType api-endpoint
 * @domain chat-harness
 * @pattern repo-config
 * @ai-summary Fixture-backed dashboard-config endpoint for the chat harness.
 *   Chat surfaces (kody-chat-data) GET/PUT per-repo config —
 *   in this dev harness it round-trips through the in-memory fixture store
 *   instead of the dashboard's GitHub-backed `dashboard.json` store.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  verifyActorLogin,
  getRequestAuth,
} from "@kody-ade/base/auth";
import {
  readFixtureDashboardConfig,
  writeFixtureDashboardConfig,
  type FixtureDashboardConfig,
} from "../../../../tests/fixtures/chat-business-fixtures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UpsertSchema = z.object({
  defaultPreviewUrl: z
    .string()
    .url({ message: "Must be a valid URL" })
    .max(2048)
    .optional()
    .or(z.literal("")),
  namedPreviews: z.array(z.unknown()).max(20).optional(),
  previewFolders: z
    .array(z.object({ id: z.string().min(1).max(64), label: z.string().min(1).max(40) }))
    .max(20)
    .optional(),
  brainFlyChatEnabled: z.boolean().optional(),
  actorLogin: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const config = await readFixtureDashboardConfig();
  return NextResponse.json({ config });
}

export async function PUT(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = UpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const verify = await verifyActorLogin(req, parsed.data.actorLogin);
  if ("status" in verify) return verify;

  // Partial merge: only fields present in the request body are overwritten,
  // matching the dashboard route's semantics.
  const bodyKeys = body && typeof body === "object" ? body : {};
  const doc = await readFixtureDashboardConfig();
  const next: FixtureDashboardConfig = { ...doc, version: 1 };
  if ("defaultPreviewUrl" in bodyKeys) {
    const trimmed = parsed.data.defaultPreviewUrl?.trim();
    next.defaultPreviewUrl = trimmed ? trimmed : undefined;
  }
  if ("namedPreviews" in bodyKeys) {
    next.namedPreviews = parsed.data.namedPreviews ?? [];
  }
  if ("previewFolders" in bodyKeys) {
    const list = parsed.data.previewFolders ?? [];
    next.previewFolders = list.length > 0 ? list : undefined;
  }
  if ("brainFlyChatEnabled" in bodyKeys) {
    next.brainFlyChatEnabled = parsed.data.brainFlyChatEnabled === true;
  }
  await writeFixtureDashboardConfig(next);
  return NextResponse.json({ ok: true, config: next });
}
