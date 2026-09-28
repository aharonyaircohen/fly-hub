import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyRepoReadAccess } from "@kody-ade/base/auth";
import { inspectRepositoryApp } from "../../../../../src/dashboard/lib/apps/source-inspection";
import { parseGitHubRepository } from "../../../../../src/dashboard/lib/apps/source-repository";

const rootDirectory = z
  .string()
  .trim()
  .max(240)
  .regex(/^(?:\.|(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+)$/);
const schema = z.object({
  repository: z.string().trim().min(3).max(300).optional(),
  rootDirectory: rootDirectory.optional(),
  ref: z.string().trim().max(240).optional(),
  name: z.string().trim().min(1).max(80).optional(),
});

export async function POST(req: NextRequest) {
  const access = await verifyRepoReadAccess(req);
  if (access instanceof NextResponse) return access;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json(
      {
        error: "invalid_app_inspection",
        message: parsed.error.issues.map((issue) => issue.message).join(" "),
      },
      { status: 400 },
    );
  const { auth, octokit } = access;
  try {
    const source = parsed.data.repository
      ? parseGitHubRepository(parsed.data.repository)
      : { owner: auth.owner, repo: auth.repo };
    return NextResponse.json(
      await inspectRepositoryApp({
        octokit,
        owner: source.owner,
        repo: source.repo,
        rootDirectory: parsed.data.rootDirectory,
        ref: parsed.data.ref,
        name: parsed.data.name,
      }),
    );
  } catch (error) {
    const invalidRepository =
      error instanceof Error && error.message === "invalid_github_repository";
    if (!invalidRepository) console.error("[Apps] inspection failed", error);
    return NextResponse.json(
      {
        error: invalidRepository
          ? "invalid_github_repository"
          : "app_source_unavailable",
      },
      {
        status: invalidRepository ? 400 : 404,
      },
    );
  }
}
