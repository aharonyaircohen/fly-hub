/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern agent-dispatch
 * @ai-summary POST /api/kody/agents/:slug/dispatch — manually send an ad-hoc
 *   message to an agent and run it like a one-shot capability. Thin dashboard
 *   rehost of @kody-ade/agency/routes/agents-slug-dispatch: identical flow,
 *   but agent resolution goes through the dashboard's Convex-backed
 *   agent-files lib (readResolvedAgentFile) instead of the package's
 *   GitHub-backed store. Posts an `@kody agent-ask --agent <slug>
 *   --thread issue:<control>` directive on the repo's "Kody control" issue;
 *   the engine's `issue_comment` trigger routes to the stateless `agent-ask`
 *   implementation, which runs the agentIdentity and replies on the control
 *   issue.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
  verifyActorLogin,
} from "@kody-ade/base/auth";
import {
  isValidSlug,
  readResolvedAgentFile,
} from "@dashboard/lib/agent-files";
import {
  findOrCreateControlIssue,
  dispatchAgentAsk,
} from "@kody-ade/base/control-issue";
import { recordAudit } from "@kody-ade/base/activity/audit";
import { logger } from "@kody-ade/base/logger";

const dispatchSchema = z.object({
  message: z.string().trim().min(1, "message is required").max(8000),
  actorLogin: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;

  const { slug } = await params;
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
  }

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  const { owner, repo } = headerAuth;

  let payload: { message: string; actorLogin?: string };
  try {
    payload = dispatchSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", details: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // Verify the claimed requester matches the authenticated token, so the
  // @-mention we inject (→ their inbox) can't be spoofed onto someone else.
  const actorResult = await verifyActorLogin(req, payload.actorLogin);
  if (actorResult instanceof NextResponse) return actorResult;

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json(
      {
        error: "no_user_token",
        message:
          "A signed-in GitHub token is required to dispatch an agent message.",
      },
      { status: 401 },
    );
  }

  try {
    const agentMember = await readResolvedAgentFile(slug, octokit);
    if (!agentMember) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    // Reply lands on the control issue. Idempotent — dispatchAgentAsk
    // resolves the same issue internally to post the directive.
    const issueNumber = await findOrCreateControlIssue(octokit, owner, repo);

    const message = payload.actorLogin
      ? `${payload.message}\n\n---\n_Dispatched from the dashboard by @${payload.actorLogin}. Open your reply by @-mentioning @${payload.actorLogin} so it reaches their inbox._`
      : payload.message;

    const res = await dispatchAgentAsk(octokit, owner, repo, {
      slug,
      message,
      reply: { kind: "issue", number: issueNumber },
    });

    recordAudit(req, {
      action: "agent.dispatch",
      resource: slug,
      agent: slug,
      resourceUrl: res.commentUrl,
      detail: "ad-hoc message dispatched",
    });

    return NextResponse.json({
      ok: true,
      issueNumber: res.issueNumber,
      commentId: res.commentId,
      commentUrl: res.commentUrl,
    });
  } catch (err: unknown) {
    logger.error({ err, slug }, "agent/dispatch: dispatch failed");
    return NextResponse.json(
      {
        error: "dispatch_failed",
        message:
          err instanceof Error
            ? err.message
            : "Failed to dispatch agent message",
      },
      { status: 500 },
    );
  }
}
