/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern chat-history
 *
 * GET /api/kody/chat/history?taskId=xxx
 *
 * Fetches the chat session history from the Convex transcript.
 * Used when reopening a task's chat to restore full conversation context.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireKodyAuth,
  getRequestAuth,
} from "@kody-ade/base/auth";
import { readSessionTranscript } from "../../../../../src/dashboard/lib/standalone-interactive-session";

export const runtime = "nodejs";

// The engine repo is determined from auth headers (client's repo).
function getEngineRepo(req: NextRequest): { owner: string; repo: string } {
  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    return { owner: headerAuth.owner, repo: headerAuth.repo };
  }
  const override = process.env.KODY_CHAT_WORKFLOW_REPO;
  if (override && override.includes("/")) {
    const [owner, repo] = override.split("/");
    return { owner, repo };
  }
  const { GITHUB_OWNER, GITHUB_REPO } = process.env as Record<string, string>;
  return {
    owner: GITHUB_OWNER ?? "aharonyaircohen",
    repo: GITHUB_REPO ?? "kody-chat",
  };
}

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const taskId = req.nextUrl.searchParams.get("taskId");
  if (!taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  const { owner, repo } = getEngineRepo(req);
  try {
    const transcript = await readSessionTranscript(owner, repo, taskId);
    if (!transcript) {
      return NextResponse.json({ messages: [] });
    }
    return NextResponse.json({ messages: transcript.turns });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Backend unavailable" },
      { status: 503 },
    );
  }
}
