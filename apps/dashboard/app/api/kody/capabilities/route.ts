/**
 * @fileType api-endpoint
 * @domain capabilities
 * @pattern capabilities-api
 * @ai-summary Capabilities Control API backed by the tenant Convex catalog.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  verifyActorLogin,
  getRequestAuth,
} from "@kody-ade/base/auth";
import {
  listCapabilityFiles,
  readCapabilityFile,
  writeCapabilityFolderFiles,
} from "@kody-ade/agency/capabilities";
import {
  setGitHubContext,
  clearGitHubContext,
  getOctokit,
} from "@dashboard/lib/github-client";
import { isValidSlug } from "@dashboard/lib/capabilities";
import { recordAudit } from "@dashboard/lib/activity/audit";
import { getEngineConfig } from "@kody-ade/base/engine/config";
import { resolveInstalledCapabilitySlugs } from "@dashboard/lib/company-store/installed-capabilities";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(
      headerAuth.owner,
      headerAuth.repo,
      headerAuth.token,
      headerAuth.storeRepoUrl,
      headerAuth.storeRef,
    );

  try {
    if (!headerAuth)
      return NextResponse.json(
        { error: "repository_context_required" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    const octokit = getOctokit();
    const { config } = await getEngineConfig(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    const activeStoreSlugs = await resolveInstalledCapabilitySlugs(
      octokit,
      config,
    );
    const projected = await listCapabilityFiles({ activeStoreSlugs });
    return NextResponse.json(
      { capabilities: projected },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error: any) {
    console.error("[Capabilities] Error listing capabilities:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }
    if (error?.status === 403 || error?.message?.includes("rate limit")) {
      return NextResponse.json(
        { error: "rate_limited", message: "GitHub API rate limit exceeded" },
        { status: 429, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      {
        capabilities: [],
        error: error?.message || "Failed to list capabilities",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  } finally {
    clearGitHubContext();
  }
}

const createCapabilitySchema = z.object({
  slug: z.string().min(1).max(64),
  instructions: z.string().min(1),
  contract: z.string().nullable().optional(),
  skills: z
    .array(z.object({ path: z.string().min(1), content: z.string() }))
    .default([]),
  tools: z
    .array(z.object({ path: z.string().min(1), content: z.string() }))
    .default([]),
  actorLogin: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(
      headerAuth.owner,
      headerAuth.repo,
      headerAuth.token,
      headerAuth.storeRepoUrl,
      headerAuth.storeRef,
    );

  try {
    const input = createCapabilitySchema.parse(await req.json());
    const slug = input.slug;
    if (!isValidSlug(slug)) {
      return NextResponse.json(
        {
          error: "invalid_slug",
          message: "Use lowercase letters, numbers, and dashes.",
        },
        { status: 400 },
      );
    }
    if (await readCapabilityFile(slug)) {
      return NextResponse.json(
        {
          error: "slug_taken",
          message: `Capability "${slug}" already exists.`,
        },
        { status: 409 },
      );
    }

    const actorResult = await verifyActorLogin(req, input.actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    if (!headerAuth)
      return NextResponse.json(
        { error: "repository_context_required" },
        { status: 400 },
      );
    const files: Record<string, string> = {
      "instructions.md": `${input.instructions.trim()}\n`,
    };
    if (input.contract === undefined) {
      files["contract.json"] = `${JSON.stringify(
        { execution: "agent", input: {}, output: {} },
        null,
        2,
      )}\n`;
    } else if (input.contract !== null) {
      files["contract.json"] = input.contract;
    }
    for (const skill of input.skills) {
      files[`skills/${skill.path}`] = skill.content;
    }
    for (const tool of input.tools) {
      files[`tools/${tool.path}`] = tool.content;
    }
    await writeCapabilityFolderFiles({
      slug,
      files,
    });
    const capability = await readCapabilityFile(slug);
    recordAudit(req, {
      action: "capability.create",
      resource: slug,
      detail: `created capability ${slug}`,
    });

    return NextResponse.json({ capability });
  } catch (error: any) {
    console.error("[Capabilities] Error creating capability:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", details: error.issues },
        { status: 400 },
      );
    }
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "create_failed",
        message: error?.message ?? "Failed to create capability",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
