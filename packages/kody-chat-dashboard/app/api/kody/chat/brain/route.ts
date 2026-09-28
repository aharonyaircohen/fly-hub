/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern chat-brain-proxy
 *
 * POST /api/kody/chat/brain
 *
 * Forwards a chat turn to the user's externally-hosted Brain server (URL +
 * API key set in Settings, sent here as `x-brain-url` / `x-brain-key`).
 *
 * For the per-user Brain server auto-provisioned on Fly, see
 * /api/kody/chat/brain-fly — same proxy core (`streamBrainChat`), different
 * credential source.
 *
 * Body: { chatId, message, taskContext?, attachments?, capabilityContext? }
 * Auth: requireKodyAuth.
 */

import { NextRequest, NextResponse } from "next/server";
import { getRequestAuth, requireKodyAuth } from "@kody-ade/base/auth";
import { rejectSurfaceScopedRequest } from "../../../../../src/dashboard/lib/chat/platform/surface-scope";
import {
  streamBrainChat,
  type BrainAgentIdentity,
  type BrainAttachment,
  type BrainCapabilityContext,
  type BrainTaskContext,
} from "@kody-ade/brain/brain-proxy";
import {
  withPageContext,
  withDashboardContext,
} from "../../../../../src/dashboard/lib/chat/core/page-context";
import { loadContextForPrompt } from "@kody-ade/workspace/context/files";
import { requestOrigin } from "@kody-ade/base/request-origin";
import { readResolvedAgentFile } from "../../../../../src/dashboard/lib/agent-files";

export const runtime = "nodejs";
// Hold the proxy open up to Vercel's ceiling; the proxy itself closes ~30s
// early with a `chat.reconnect` sentinel so the browser resumes cleanly.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // Surface tickets (phase 2 step 6) are limited to the in-process kody
  // endpoint; this backend is admin-only. PAT requests pass untouched.
  const surfaceRejection = rejectSurfaceScopedRequest(req.headers);
  if (surfaceRejection) return surfaceRejection;
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  // Per-user Brain config from headers (preferred) → server-wide env fallback.
  const brainUrl =
    req.headers.get("x-brain-url")?.trim() || process.env.BRAIN_CHAT_URL;
  const brainKey =
    req.headers.get("x-brain-key")?.trim() || process.env.BRAIN_CHAT_API_KEY;

  if (!brainUrl || !brainKey) {
    return NextResponse.json(
      {
        error:
          "Brain is not configured for this session. Add a Brain server URL and API key on the login page.",
      },
      { status: 503 },
    );
  }

  let body: {
    chatId?: string;
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
    /**
     * First turn of a Brain chat. When set, fold the dashboard's curated
     * Context (the /context feature) into the message so Brain answers with
     * the same standing context the in-process `kody` chat gets. Sent once —
     * Brain is stateful and keeps it for the chat's life.
     */
    includeContext?: boolean;
    /**
     * User-picked thinking level. Forwarded verbatim to the Brain server.
     * Server-side: older Brain versions ignore this field; newer versions
     * translate it to the upstream provider's wire shape.
     */
    reasoningEffort?: string;
    agentSlug?: string;
    workspaceMode?: "repository" | "host";
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

  // Forward the user's connected repo so Brain can clone it into a worktree
  // and enable code-context tools. Locked on first turn by Brain.
  const headerAuth = getRequestAuth(req);
  const useHostWorkspace = body.workspaceMode === "host";
  const repo =
    !useHostWorkspace && headerAuth
      ? `${headerAuth.owner}/${headerAuth.repo}`
      : undefined;
  // Forward the user's token too — a dev Brain server has no GitHub creds of
  // its own, so without this the worktree clone of a private repo fails.
  const repoToken = useHostWorkspace ? undefined : headerAuth?.token;
  const dashboardUrl = requestOrigin(req);

  // First turn only: pull the dashboard's curated Context for the chat
  // audience. Cached 60s in-process; `null` when the repo has none.
  const dashboardContext =
    !useHostWorkspace && !isResume && body.includeContext
      ? await loadContextForPrompt()
      : null;
  let agentIdentity: BrainAgentIdentity | undefined;
  if (!isResume && body.agentSlug) {
    const agent = await readResolvedAgentFile(body.agentSlug).catch(() => null);
    if (agent?.body.trim()) {
      agentIdentity = {
        slug: agent.slug,
        title: agent.title,
        body: agent.body,
      };
    }
  }

  return streamBrainChat({
    brainUrl,
    brainKey,
    chatId,
    // Brain has no ambient-context slot; prefix the page + standing dashboard
    // Context onto the user message (skip on resume, which has no new message).
    message: isResume
      ? ""
      : useHostWorkspace
        ? (message ?? "")
        : withDashboardContext(
            withPageContext(message ?? "", body.currentPage),
            dashboardContext,
          ),
    ...(!useHostWorkspace && body.taskContext
      ? { taskContext: body.taskContext }
      : {}),
    attachments: body.attachments,
    ...(!useHostWorkspace && body.capabilityContext
      ? { capabilityContext: body.capabilityContext }
      : {}),
    ...(repo ? { repo } : {}),
    ...(repoToken ? { repoToken } : {}),
    dashboardUrl,
    ...(agentIdentity ? { agentIdentity } : {}),
    ...(!useHostWorkspace && headerAuth?.storeRepoUrl
      ? { storeRepoUrl: headerAuth.storeRepoUrl }
      : {}),
    ...(!useHostWorkspace && headerAuth?.storeRef
      ? { storeRef: headerAuth.storeRef }
      : {}),
    voiceMode: body.voiceMode === true,
    ...(body.modelId ? { modelId: body.modelId } : {}),
    ...(body.runtime ? { runtime: body.runtime } : {}),
    ...(body.reasoningEffort ? { reasoningEffort: body.reasoningEffort } : {}),
    ...(isResume
      ? { resumeSince: Number(body.resumeSince), resumeText: body.resumeText }
      : {}),
  });
}
