/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern chat-brain-fly-proxy
 *
 * POST /api/kody/chat/brain-fly
 *
 * Repo Brain server proxy. Same wire shape as /api/kody/chat/brain
 * (request body + SSE response), with credentials resolved server-side
 * by lazily provisioning the user's Fly runtime. The dashboard never stores
 * or shows the Brain URL/key.
 *
 * Lifecycle:
 *   1. requireKodyAuth + resolveServerProviderContext (reads FLY_API_TOKEN from the
 *      repo's secrets vault).
 *   2. manageBrainServer("provision") — idempotent. Creates the per-user app + machine
 *      on the first call (~30s); reuses both on later calls and returns
 *      the existing API key from the machine's env.
 *   3. streamBrainChat() — same proxy core used by /api/kody/chat/brain.
 *
 * When the user has no Fly token, the endpoint returns 400 with a
 * pointer back to the Secrets page. The chat-picker hides this agent
 * for that case, but the server still guards against direct calls.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  BrainCommandError,
  manageBrainServer,
} from "@kody-ade/brain/server-commands";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { logger } from "@kody-ade/base/logger";
import {
  streamBrainChat,
  type BrainAgentIdentity,
  type BrainAttachment,
  type BrainCapabilityContext,
  type BrainTaskContext,
} from "@kody-ade/brain/brain-proxy";
import { waitForServerBrainHealth } from "@kody-ade/fly/infrastructure/server-brain";
import { resolveServerProviderContext } from "@kody-ade/fly/infrastructure/server-context";
import { resolvePersonalBrainContext } from "@kody-ade/brain/personal-context";
import type { PersonalBrainContext } from "@kody-ade/brain/personal-context";
import { requestOrigin } from "@kody-ade/base/request-origin";
import {
  withPageContext,
  withDashboardContext,
} from "@kody-ade/kody-chat-dashboard/core/page-context";
import { loadContextForPrompt } from "@kody-ade/workspace/context/files";
import { createRepoBrainScope } from "@kody-ade/brain/repo-scope";
import { readResolvedAgentFile } from "@dashboard/lib/agent-files";
import { withDashboardFeatureGuideContext } from "@dashboard/lib/feature-guides/brain-context";

export const runtime = "nodejs";
// Restore can mirror a full Brain image before the chat stream starts.
export const maxDuration = 300;
const REPO_BRAIN_AGENT_SLUG = "repo-brain";

function brainSuspendOnIdleFrom(req: NextRequest): boolean | undefined {
  const raw = req.headers.get("x-kody-brain-suspension");
  if (raw === "never") return false;
  if (raw === "auto") return true;
  return undefined;
}

export async function POST(req: NextRequest) {
  const ctx = await resolvePersonalBrainContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  if (!ctx.context.flyToken) {
    return NextResponse.json(
      {
        error:
          "Brain on Fly needs a Fly token - add FLY_API_TOKEN to Personal Credentials.",
      },
      { status: 400 },
    );
  }
  const personalContext: PersonalBrainContext = ctx.context;

  let body: {
    chatId?: string;
    conversationId?: string;
    modelId?: string;
    runtime?: string;
    message?: string;
    taskContext?: BrainTaskContext;
    attachments?: BrainAttachment[];
    capabilityContext?: BrainCapabilityContext;
    voiceMode?: boolean;
    resumeSince?: number;
    resumeText?: string;
    /** Noun phrase for the page the user is viewing (see page-context.ts). */
    currentPage?: string;
    /** First turn: fold the dashboard's curated Context into the message. */
    includeContext?: boolean;
    /** User-picked thinking level. Forwarded verbatim to Brain. */
    reasoningEffort?: string;
    agentSlug?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const chatId = body.chatId?.trim();
  const message = body.message;
  // A reconnect carries `resumeSince` and no message — it re-attaches to an
  // in-flight turn rather than starting a new one.
  const isResume = Number.isFinite(body.resumeSince);
  if (!chatId) {
    return NextResponse.json({ error: "chatId required" }, { status: 400 });
  }
  if (!isResume && (!message || typeof message !== "string")) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  const repoContext = await resolveServerProviderContext(req);
  if (repoContext.ok) {
    setGitHubContext(
      repoContext.context.owner,
      repoContext.context.repo,
      repoContext.context.githubToken,
      repoContext.context.storeRepoUrl,
      repoContext.context.storeRef,
    );
  }

  try {
    const dashboardUrl = requestOrigin(req);
    let provisioned: { url: string; apiKey: string; app?: string };
    try {
      const result = await manageBrainServer({
        command: "provision",
        context: personalContext,
        perfTier: personalContext.perfTier,
        suspendOnIdle: brainSuspendOnIdleFrom(req),
        dashboardUrl,
      });
      provisioned = { url: result.url, apiKey: result.apiKey, app: result.app };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        { err, userId: ctx.context.userId },
        "chat/brain-fly: Brain provision command failed",
      );
      if (
        err instanceof BrainCommandError &&
        err.code === "brain_provision_retryable"
      ) {
        return NextResponse.json(
          { error: `Brain is preparing: ${message}` },
          {
            status: 503,
            headers: { "Retry-After": String(err.retryAfterSeconds ?? 30) },
          },
        );
      }
      return NextResponse.json(
        { error: `Brain provision failed: ${message}` },
        { status: 502 },
      );
    }

    // Provision returns when the Fly Machine API has accepted the create
    // call, but the Node server inside doesn't bind :8080 until the
    // entrypoint finishes the repo clone + model proxy + brain-serve startup.
    // Measured cold boot is ~105s and varies with git-clone time, so the
    // 120s default tipped over on normal variance. Budget 240s here (the
    // poll returns the instant /healthz is 200 — the larger number only
    // prevents premature failure, and stays well under maxDuration=300).
    // On reuse / resume-from-suspend the server is already up and this
    // returns on the first poll.
    try {
      await waitForServerBrainHealth(provisioned.url, 240_000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        { err, userId: ctx.context.userId, url: provisioned.url },
        "chat/brain-fly: brain server did not become healthy",
      );
      return NextResponse.json(
        { error: `Brain server did not become healthy: ${message}` },
        { status: 504 },
      );
    }

    const repoScope = repoContext.ok
      ? createRepoBrainScope({
          owner: repoContext.context.owner,
          repo: repoContext.context.repo,
          storeRepoUrl: repoContext.context.storeRepoUrl,
          storeRef: repoContext.context.storeRef,
        })
      : undefined;
    const repoToken = repoContext.ok
      ? repoContext.context.githubToken
      : undefined;

    // First turn only: pull the dashboard's curated Context for the chat
    // audience. Cached 60s in-process; `null` when the repo has none.
    //
    // Best-effort: this is the ONLY first-turn-only step here, and it reaches
    // GitHub via server-side creds. If it throws (e.g. a misconfigured server
    // token/owner/repo in this environment), it must NOT take down the whole
    // chat — that would 500 the first message while every later message (which
    // omits includeContext) succeeds. Degrade to no-context instead.
    let dashboardContext: string | null = null;
    if (!isResume && body.includeContext) {
      try {
        dashboardContext = await loadContextForPrompt();
      } catch (err) {
        logger.warn(
          { err, userId: ctx.context.userId },
          "chat/brain-fly: dashboard Context load failed — proceeding without it",
        );
      }
    }

    let messageWithFeatureGuide = message ?? "";
    if (!isResume) {
      try {
        messageWithFeatureGuide = await withDashboardFeatureGuideContext({
          message: message ?? "",
          currentPage: body.currentPage,
        });
      } catch (err) {
        logger.warn(
          { err, userId: ctx.context.userId },
          "chat/brain-fly: feature guide load failed — proceeding without it",
        );
      }
    }

    let agentIdentity: BrainAgentIdentity | undefined;
    if (!isResume) {
      try {
        if (!repoContext.ok) throw new Error("No repository selected");
        const repoBrain = await readResolvedAgentFile(
          body.agentSlug || REPO_BRAIN_AGENT_SLUG,
        );
        if (repoBrain?.body.trim()) {
          agentIdentity = {
            slug: repoBrain.slug,
            title: repoBrain.title,
            body: repoBrain.body,
          };
        }
      } catch (err) {
        logger.warn(
          { err, userId: ctx.context.userId },
          "chat/brain-fly: repo-brain agent load failed — proceeding with default Brain identity",
        );
      }
    }

    return await streamBrainChat({
      brainUrl: provisioned.url,
      brainKey: provisioned.apiKey,
      chatId,
      ...(body.conversationId ? { conversationId: body.conversationId } : {}),
      ...(body.modelId ? { modelId: body.modelId } : {}),
      ...(body.runtime ? { runtime: body.runtime } : {}),
      // Brain has no ambient-context slot; prefix page + standing dashboard
      // Context onto the user message (skip on resume — no new message).
      message: isResume
        ? ""
        : withDashboardContext(
            withPageContext(messageWithFeatureGuide, body.currentPage),
            dashboardContext,
          ),
      taskContext: body.taskContext,
      attachments: body.attachments,
      capabilityContext: body.capabilityContext,
      ...(repoScope ? { repoScope } : {}),
      ...(repoToken ? { repoToken } : {}),
      dashboardUrl,
      ...(agentIdentity ? { agentIdentity } : {}),
      voiceMode: body.voiceMode === true,
      ...(body.reasoningEffort
        ? { reasoningEffort: body.reasoningEffort }
        : {}),
      firstTurn: !isResume && body.includeContext === true,
      // Repo Brain on Fly answers in plain, simple terms (external /brain
      // keeps its own style). See PLAIN_LANGUAGE_PREAMBLE in brain-proxy.
      plainLanguage: true,
      ...(isResume
        ? { resumeSince: Number(body.resumeSince), resumeText: body.resumeText }
        : {}),
    });
  } finally {
    clearGitHubContext();
  }
}
import "@dashboard/lib/brain/personal-services";
