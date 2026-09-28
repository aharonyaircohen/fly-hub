/**
 * @fileType api-endpoint
 * @domain dashboard-config
 * @pattern repo-config
 * @ai-summary GET — return per-repo dashboard config from the Convex
 *   `repoDocs` doc (kind `dashboard-config`). PUT — partial-merge upsert
 *   (preview environments/folders, default preview URL, chat toggles) back
 *   to the same Convex doc. GitHub is touched only to enrich repo-backed
 *   view entries with source links.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  verifyActorLogin,
  getRequestAuth,
} from "@kody-ade/base/auth";
import {
  invalidateDashboardConfigCache,
  readDashboardConfig,
  writeDashboardConfig,
  type DashboardConfig,
} from "@dashboard/lib/dashboard-config/store";
import { logger } from "@kody-ade/base/logger";

const PreviewUrlSchema = z
  .string()
  .max(2048)
  .refine(
    (value) => {
      if (
        /^\/api\/kody\/views\/(?!_t\/)[A-Za-z0-9][A-Za-z0-9-]{0,63}(?:\/[^\s?#]*)?(?:\?[^#\s]*)?(?:#[^\s]*)?$/.test(
          value,
        )
      ) {
        return true;
      }
      try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Must be a valid URL" },
  );

const FlyBranchPreviewSchema = z.object({
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  branch: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[^\s\x00-\x1f\x7f]+$/),
});

const PreviewEnvironmentSchema = z
  .object({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(48),
    url: PreviewUrlSchema.optional(),
    flyBranch: FlyBranchPreviewSchema.optional(),
    // Present only for uploaded-file environments — keys the Fly static
    // preview so removal can also tear it down.
    staticId: z.string().min(1).max(64).optional(),
    // Absolute expiry (ms epoch) for uploaded previews; reaped past this.
    expiresAt: z.number().int().nonnegative().optional(),
    // Present only repo-backed views stored under views/<id>.
    repoViewPath: z
      .string()
      .regex(/^(?:\.kody\/)?views\/[a-z0-9][a-z0-9-]{0,63}$/)
      .optional(),
    repoViewSourceUrl: z.string().url().max(2048).optional(),
    repoViewEntryPath: z
      .string()
      .regex(/^[^\\\0]+$/)
      .max(255)
      .optional(),
    // Small, non-secret summary of uploaded files so chat can understand the
    // preview even before the inspector extension can read the iframe.
    uploadContext: z
      .object({
        name: z.string().min(1).max(255),
        mimeType: z.string().max(120).optional(),
        size: z.number().int().nonnegative().optional(),
        title: z.string().max(200).optional(),
        outline: z.string().max(4000).optional(),
        textPreview: z.string().max(2000).optional(),
      })
      .optional(),
    folderId: z.string().min(1).max(64).optional(),
  })
  .refine((value) => Boolean(value.url) || Boolean(value.flyBranch), {
    message: "Environment needs a URL or Fly branch preview",
    path: ["url"],
  })
  .refine(
    (value) => Boolean(value.url) || (!value.staticId && !value.repoViewPath),
    {
      message: "Uploaded and repo-backed views need a URL",
      path: ["url"],
    },
  );

const UpsertSchema = z.object({
  defaultPreviewUrl: z
    .string()
    .url({ message: "Must be a valid URL" })
    .max(2048)
    .optional()
    .or(z.literal("")),
  namedPreviews: z.array(PreviewEnvironmentSchema).max(20).optional(),
  previewFolders: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        label: z.string().min(1).max(40),
      }),
    )
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

  try {
    const { doc } = await readDashboardConfig(auth.owner, auth.repo);
    return NextResponse.json({ config: doc });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo },
      "dashboard-config: read failed",
    );
    return NextResponse.json(
      { error: "config_read_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
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

  try {
    const { doc, sha } = await readDashboardConfig(auth.owner, auth.repo, {
      force: true,
    });
    // Partial merge: only fields present in the request body are
    // overwritten, so a Vibe-page save and a chat-default save don't
    // clobber each other's value.
    const bodyKeys = body && typeof body === "object" ? body : {};
    const next: DashboardConfig = { ...doc, version: 1 };
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
    await writeDashboardConfig(auth.owner, auth.repo, next);
    invalidateDashboardConfigCache(auth.owner, auth.repo);
    return NextResponse.json({ ok: true, config: next });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo },
      "dashboard-config: write failed",
    );
    return NextResponse.json(
      { error: "config_write_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
