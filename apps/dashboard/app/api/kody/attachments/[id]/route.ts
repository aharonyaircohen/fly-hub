import { NextRequest, NextResponse } from "next/server";

import { getUserOctokit, requireKodyAuth } from "@kody-ade/base/auth";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";

const ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPO_PART = /^[A-Za-z0-9_.-]{1,100}$/;

function contentType(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase();
  return (
    {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
      bmp: "image/bmp",
      avif: "image/avif",
      pdf: "application/pdf",
      txt: "text/plain; charset=utf-8",
    }[extension ?? ""] ?? "application/octet-stream"
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const { id } = await params;
  const owner = req.nextUrl.searchParams.get("owner") ?? "";
  const repo = req.nextUrl.searchParams.get("repo") ?? "";
  if (!ID.test(id) || !REPO_PART.test(owner) || !REPO_PART.test(repo)) {
    return NextResponse.json({ error: "invalid_attachment" }, { status: 400 });
  }

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "no_user_token" }, { status: 401 });
  }
  try {
    await octokit.repos.get({ owner, repo });
  } catch {
    return NextResponse.json(
      { error: "attachment_not_found" },
      { status: 404 },
    );
  }

  const record = await createBackendClient().query(backendApi.repoDocs.get, {
    tenantId: `${owner}/${repo}`,
    kind: `attachment:${id}`,
  });
  const doc = record?.doc as
    { name?: unknown; contentBase64?: unknown; isImage?: unknown } | undefined;
  if (typeof doc?.name !== "string" || typeof doc.contentBase64 !== "string") {
    return NextResponse.json(
      { error: "attachment_not_found" },
      { status: 404 },
    );
  }

  const bytes = Buffer.from(doc.contentBase64, "base64");
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": contentType(doc.name),
      "Content-Disposition": `${doc.isImage ? "inline" : "attachment"}; filename="${doc.name.replace(/["\\]/g, "_")}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
