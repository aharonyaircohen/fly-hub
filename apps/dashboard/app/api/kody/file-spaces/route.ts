import { Buffer } from "node:buffer";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@kody-ade/base/auth";
import { logger } from "@kody-ade/base/logger";
import {
  readDashboardConfig,
  writeDashboardConfig,
} from "@dashboard/lib/dashboard-config/store";
import {
  createFileSpace,
  normalizeFileSpaces,
  reorderFileSpaces,
  updateFileSpace,
  type StoredFileSpace,
} from "@dashboard/features/file-spaces/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const titleSchema = z.string().trim().min(1).max(64);
const createSchema = z.object({ title: titleSchema }).strict();
const updateSchema = z.object({ id: z.string().min(1), title: titleSchema }).strict();
const reorderSchema = z.object({ ids: z.array(z.string().min(1)).max(50) }).strict();

function customSpaces(value: unknown): StoredFileSpace[] {
  return normalizeFileSpaces(value).filter(
    (space): space is StoredFileSpace => !space.builtIn,
  );
}

async function context(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return { ok: false, response: authError as NextResponse } as const;
  const auth = getRequestAuth(req);
  if (!auth) {
    return {
      ok: false,
      response: NextResponse.json({ message: "No repository selected" }, { status: 400 }),
    } as const;
  }
  return { ok: true, auth } as const;
}

async function ensureFolder(req: NextRequest, owner: string, repo: string, rootPath: string) {
  const octokit = await getUserOctokit(req);
  if (!octokit) throw new Error("GitHub access is unavailable");
  try {
    await octokit.repos.getContent({ owner, repo, path: rootPath });
    return;
  } catch (error) {
    if ((error as { status?: number }).status !== 404) throw error;
  }
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: `${rootPath}/.gitkeep`,
    message: `chore: create ${rootPath}/ file space`,
    content: Buffer.from("").toString("base64"),
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const resolved = await context(req);
  if (!resolved.ok) return resolved.response;
  const { auth } = resolved;
  const { doc } = await readDashboardConfig(auth.owner, auth.repo);
  return NextResponse.json({ spaces: normalizeFileSpaces(doc.fileSpaces) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const resolved = await context(req);
  if (!resolved.ok) return resolved.response;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid file space" }, { status: 400 });
  }
  const { auth } = resolved;
  try {
    const { doc } = await readDashboardConfig(auth.owner, auth.repo, { force: true });
    const space = createFileSpace(parsed.data.title, normalizeFileSpaces(doc.fileSpaces));
    await ensureFolder(req, auth.owner, auth.repo, space.rootPath);
    await writeDashboardConfig(auth.owner, auth.repo, {
      ...doc,
      version: 1,
      fileSpaces: [...customSpaces(doc.fileSpaces), space],
    });
    return NextResponse.json({ space }, { status: 201 });
  } catch (error) {
    logger.error({ error, owner: auth.owner, repo: auth.repo }, "file-spaces: create failed");
    const message = error instanceof Error ? error.message : "Failed to create file space";
    const status = /reserved|already exists/.test(message)
      ? 409
      : /name|letters|numbers|characters/i.test(message)
        ? 400
        : 500;
    return NextResponse.json({ message }, { status });
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const resolved = await context(req);
  if (!resolved.ok) return resolved.response;
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || parsed.data.id === "docs") {
    return NextResponse.json({ message: "Invalid file space" }, { status: 400 });
  }
  const { auth } = resolved;
  const { doc } = await readDashboardConfig(auth.owner, auth.repo, { force: true });
  const spaces = customSpaces(doc.fileSpaces);
  const current = spaces.find((space) => space.id === parsed.data.id);
  if (!current) return NextResponse.json({ message: "File space not found" }, { status: 404 });
  const space = updateFileSpace(current, { title: parsed.data.title });
  await writeDashboardConfig(auth.owner, auth.repo, {
    ...doc,
    version: 1,
    fileSpaces: spaces.map((item) => (item.id === space.id ? space : item)),
  });
  return NextResponse.json({ space });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const resolved = await context(req);
  if (!resolved.ok) return resolved.response;
  const parsed = reorderSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid file space order" }, { status: 400 });
  }
  const { auth } = resolved;
  const { doc } = await readDashboardConfig(auth.owner, auth.repo, { force: true });
  let fileSpaces: StoredFileSpace[];
  try {
    fileSpaces = reorderFileSpaces(customSpaces(doc.fileSpaces), parsed.data.ids);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Invalid file space order" },
      { status: 400 },
    );
  }
  try {
    await writeDashboardConfig(auth.owner, auth.repo, { ...doc, version: 1, fileSpaces });
    return NextResponse.json({ spaces: normalizeFileSpaces(fileSpaces) });
  } catch (error) {
    logger.error({ error, owner: auth.owner, repo: auth.repo }, "file-spaces: reorder failed");
    return NextResponse.json(
      { message: "Failed to save file space order" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const resolved = await context(req);
  if (!resolved.ok) return resolved.response;
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id || id === "docs") {
    return NextResponse.json({ message: "Invalid file space" }, { status: 400 });
  }
  const { auth } = resolved;
  const { doc } = await readDashboardConfig(auth.owner, auth.repo, { force: true });
  const spaces = customSpaces(doc.fileSpaces);
  if (!spaces.some((space) => space.id === id)) {
    return NextResponse.json({ message: "File space not found" }, { status: 404 });
  }
  await writeDashboardConfig(auth.owner, auth.repo, {
    ...doc,
    version: 1,
    fileSpaces: spaces.filter((space) => space.id !== id),
  });
  return NextResponse.json({ ok: true });
}
