/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern agent-api
 * @ai-summary Agent Control API — GET lists agent, POST creates one.
 *   An agent is a markdown file at `agents/<slug>.md` in the backend.
 *   Duplicated from the capabilities API; the manual "Run now"
 *   path reuses the engine's `capability-tick` plumbing.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  verifyRepoReadAccess,
  verifyRepoWriteAccess,
  verifyActorLogin,
  getRequestAuth,
} from "@kody-ade/base/auth";
import { setGitHubContext, clearGitHubContext, getOctokit } from "../github";
import {
  listResolvedAgentFiles,
  writeAgentFile,
  isValidSlug,
  readAgentFile,
} from "../agent-files";
import { normalizeAgentSlug } from "../agent-slug";
import { getEngineConfig } from "@kody-ade/base/engine/config";
import { recordAudit } from "@kody-ade/base/activity/audit";
import { readBuiltinAgentFile } from "../builtin-agents";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: NextRequest) {
  const authResult = await verifyRepoReadAccess(req);
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
        { agent: [], error: "repository_context_required" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    const octokit = getOctokit();
    const { config } = await getEngineConfig(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    const activeStoreSlugs = new Set(config.company?.activeAgents ?? []);
    return NextResponse.json(
      { agent: await listResolvedAgentFiles({ activeStoreSlugs }) },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error: any) {
    console.error("[Agent] Error fetching agent:", error);

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
      { agent: [], error: error?.message || "Failed to fetch agent" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  } finally {
    clearGitHubContext();
  }
}

const createAgentSchema = z.object({
  slug: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim().length === 0
        ? undefined
        : value,
    z.string().max(64).optional(),
  ),
  title: z.string().min(1),
  body: z.string().default(""),
  whenToUse: z.string().trim().max(500).optional(),
  primaryIntent: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
    .optional(),
  capabilities: z.array(z.string()).max(50).optional(),
  subagents: z
    .array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/))
    .max(20)
    .optional(),
  actorLogin: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const authResult = await verifyRepoWriteAccess(req);
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
    const payload = await req.json();
    const {
      slug: requestedSlug,
      title,
      body,
      whenToUse,
      primaryIntent,
      capabilities,
      subagents,
      actorLogin,
    } = createAgentSchema.parse(payload);

    const slug = normalizeAgentSlug(requestedSlug ?? title);
    if (!slug || !isValidSlug(slug)) {
      return NextResponse.json(
        {
          error: "invalid_slug",
          message:
            "Agent slug must be lowercase letters, digits, dashes, or underscores.",
        },
        { status: 400 },
      );
    }
    const assignedSubagents = [...new Set(subagents ?? [])];
    if (assignedSubagents.includes(slug)) {
      return NextResponse.json(
        {
          error: "invalid_subagent_assignment",
          message: "An Agent cannot assign itself as a subagent.",
        },
        { status: 400 },
      );
    }

    if (readBuiltinAgentFile(slug)) {
      return NextResponse.json(
        {
          error: "builtin_agent_locked",
          message: "Built-in Agents cannot be replaced by local configuration.",
        },
        { status: 409 },
      );
    }
    const resolvedAgents =
      assignedSubagents.length > 0 ? await listResolvedAgentFiles() : [];
    const unrouteableSubagent = assignedSubagents.find((assignedSlug) => {
      const assigned = resolvedAgents.find(
        (candidate) => candidate.slug === assignedSlug,
      );
      return !assigned?.whenToUse?.trim();
    });
    if (unrouteableSubagent) {
      return NextResponse.json(
        {
          error: "subagent_routing_required",
          message: `Agent "${unrouteableSubagent}" needs a When to use description before it can be assigned as a subagent.`,
        },
        { status: 400 },
      );
    }

    const existing = await readAgentFile(slug);
    if (existing) {
      return NextResponse.json(
        {
          error: "slug_taken",
          message: `Agent member "${slug}" already exists.`,
        },
        { status: 409 },
      );
    }

    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const agentMember = await writeAgentFile({
      slug,
      title,
      body,
      ...(whenToUse ? { whenToUse } : {}),
      ...(primaryIntent ? { primaryIntent } : {}),
      ...(capabilities ? { capabilities } : {}),
      ...(assignedSubagents.length > 0 ? { subagents: assignedSubagents } : {}),
    });
    if (!headerAuth) {
      throw new Error("Repository context is required to save an agent");
    }
    recordAudit(req, {
      action: "agent.create",
      resource: slug,
      agent: slug,
      detail: `created agent "${title}"`,
    });

    return NextResponse.json({ agentMember });
  } catch (error: any) {
    console.error("[Agent] Error creating agent:", error);

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
        message: error?.message ?? "Failed to create agent",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
