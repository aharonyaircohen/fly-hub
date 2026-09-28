/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern agent-api
 * @ai-summary Agent detail API — GET reads a single agent file, PATCH
 *   updates the title/body, DELETE removes the file. Backed by
 *   `agents/<slug>.md` in the backend. Duplicated
 *   from the capabilities detail API.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  verifyRepoReadAccess,
  verifyRepoWriteAccess,
  verifyActorLogin,
  getUserOctokit,
  getRequestAuth,
} from "@kody-ade/base/auth";
import { setGitHubContext, clearGitHubContext } from "../github";
import {
  readAgentFile,
  listResolvedAgentFiles,
  writeAgentFile,
  deleteAgentFile,
  isValidSlug,
} from "../agent-files";
import {
  getEngineConfig,
  writeConfigPatch,
} from "@kody-ade/base/engine/config";
import { recordAudit } from "@kody-ade/base/activity/audit";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
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
    const { slug } = await params;
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }
    const agentMember = (await listResolvedAgentFiles()).find(
      (candidate) => candidate.slug === slug,
    );
    if (!agentMember) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ agentMember });
  } catch (error: any) {
    console.error("[Agent] Error fetching agent:", error);
    return NextResponse.json(
      {
        error: "fetch_failed",
        message: error?.message ?? "Failed to fetch agent",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

const updateAgentSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  whenToUse: z.string().trim().max(500).optional(),
  primaryIntent: z
    .union([z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/), z.literal("")])
    .optional(),
  capabilities: z.array(z.string()).max(50).optional(),
  subagents: z
    .array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/))
    .max(20)
    .optional(),
  actorLogin: z.string().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
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
    const { slug } = await params;
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }

    const resolvedAgents = await listResolvedAgentFiles();
    const existing = resolvedAgents.find(
      (candidate) => candidate.slug === slug,
    );
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const payload = await req.json();
    const {
      title,
      body,
      whenToUse,
      primaryIntent,
      capabilities,
      subagents,
      actorLogin,
    } = updateAgentSchema.parse(payload);

    if (existing.source === "builtin") {
      const changesIdentity =
        title !== undefined ||
        body !== undefined ||
        whenToUse !== undefined ||
        capabilities !== undefined;
      if (
        changesIdentity ||
        (subagents === undefined && primaryIntent === undefined) ||
        (slug !== "kody" && subagents !== undefined)
      ) {
        return NextResponse.json(
          {
            error: "builtin_agent_locked",
            message: "Built-in Agent identities cannot be edited.",
          },
          { status: 403 },
        );
      }
    }

    const assignedSubagents =
      subagents === undefined ? existing.subagents : [...new Set(subagents)];
    if (assignedSubagents?.includes(slug)) {
      return NextResponse.json(
        {
          error: "invalid_subagent_assignment",
          message: "An Agent cannot assign itself as a subagent.",
        },
        { status: 400 },
      );
    }

    const lockedSubagents = existing.lockedSubagents ?? [];
    const effectiveSubagents = [
      ...new Set([...lockedSubagents, ...(assignedSubagents ?? [])]),
    ];
    const unrouteableSubagent = effectiveSubagents.find((assignedSlug) => {
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

    const nextWhenToUse =
      whenToUse === undefined ? existing.whenToUse : whenToUse;
    const nextPrimaryIntent =
      primaryIntent === undefined
        ? existing.primaryIntent
        : primaryIntent || undefined;
    if (
      whenToUse !== undefined &&
      !nextWhenToUse?.trim() &&
      resolvedAgents.some((candidate) => candidate.subagents?.includes(slug))
    ) {
      return NextResponse.json(
        {
          error: "subagent_routing_required",
          message: "An assigned subagent must keep a When to use description.",
        },
        { status: 400 },
      );
    }

    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    let agentMember;
    if (existing.source === "builtin") {
      const additionalSubagents = effectiveSubagents.filter(
        (assignedSlug) => !lockedSubagents.includes(assignedSlug),
      );
      if (additionalSubagents.length === 0 && !nextPrimaryIntent) {
        await deleteAgentFile(slug);
      } else {
        await writeAgentFile({
          slug,
          title: existing.title,
          body: existing.body,
          sha: "",
          capabilities: existing.capabilities,
          subagents: additionalSubagents,
          ...(nextPrimaryIntent ? { primaryIntent: nextPrimaryIntent } : {}),
        });
      }
      agentMember = {
        ...existing,
        subagents: effectiveSubagents,
        ...(nextPrimaryIntent ? { primaryIntent: nextPrimaryIntent } : {}),
      };
      if (!nextPrimaryIntent) delete agentMember.primaryIntent;
    } else {
      agentMember = await writeAgentFile({
        slug,
        title: title ?? existing.title,
        body: body ?? existing.body,
        sha: existing.sha,
        capabilities: capabilities ?? existing.capabilities,
        subagents: assignedSubagents,
        ...(nextWhenToUse ? { whenToUse: nextWhenToUse } : {}),
        ...(nextPrimaryIntent ? { primaryIntent: nextPrimaryIntent } : {}),
      });
    }
    if (!headerAuth) {
      throw new Error("Repository context is required to save an agent");
    }
    recordAudit(req, {
      action: "agent.update",
      resource: slug,
      agent: slug,
      detail: "edited agent",
    });

    return NextResponse.json({ agentMember });
  } catch (error: any) {
    console.error("[Agent] Error updating agent:", error);

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
        error: "update_failed",
        message: error?.message ?? "Failed to update agent",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
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
    const { slug } = await params;
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const actorLogin = searchParams.get("actorLogin") ?? undefined;

    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const existing = await readAgentFile(slug);
    if (!existing) {
      if (!headerAuth) {
        return NextResponse.json({ success: true, alreadyMissing: true });
      }

      const userOctokit = await getUserOctokit(req);
      if (!userOctokit) {
        return NextResponse.json(
          {
            error: "no_user_token",
            message:
              "A signed-in GitHub token is required to update repository configuration.",
          },
          { status: 401 },
        );
      }
      const { config } = await getEngineConfig(
        userOctokit,
        headerAuth.owner,
        headerAuth.repo,
        { force: true },
      );
      const activeAgents = config.company?.activeAgents ?? [];
      if (!activeAgents.includes(slug)) {
        return NextResponse.json({ success: true, alreadyMissing: true });
      }

      const nextActiveAgents = activeAgents.filter((value) => value !== slug);
      await writeConfigPatch(
        userOctokit,
        headerAuth.owner,
        headerAuth.repo,
        {
          activeAgents: nextActiveAgents.length > 0 ? nextActiveAgents : null,
        },
        `chore(kody): remove store agent ${slug}`,
      );

      recordAudit(req, {
        action: "agent.removeStoreReference",
        resource: slug,
        agent: slug,
        detail: "removed store agent reference",
      });
      return NextResponse.json({ success: true, removedStoreReference: true });
    }

    await deleteAgentFile(slug);

    recordAudit(req, {
      action: "agent.delete",
      resource: slug,
      agent: slug,
      detail: "deleted agent",
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Agent] Error deleting agent:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "delete_failed",
        message: error?.message ?? "Failed to delete agent",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
