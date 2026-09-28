import { resolve } from "node:path";
import { config } from "dotenv";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import {
  backendApi,
  getConvexClient,
  tenantIdFor,
} from "../../src/dashboard/lib/backend/convex-backend";

const liveBrainUrlOverride = process.env.BRAIN_FEATURE_GUIDE_LIVE_URL;
const liveBrainKeyOverride = process.env.BRAIN_FEATURE_GUIDE_LIVE_KEY;

config({
  path: resolve(import.meta.dirname, "../../../../.env"),
  quiet: true,
});
config({
  path: resolve(import.meta.dirname, "../../.env"),
  quiet: true,
  override: true,
});

const RUN_LIVE = process.env.RUN_BRAIN_FEATURE_GUIDE_LIVE === "1";

function repoFromUrl(raw: string): { owner: string; repo: string } {
  const url = new URL(raw);
  const [owner, repo] = url.pathname.replace(/^\//, "").split("/");
  if (!owner || !repo)
    throw new Error("E2E_GITHUB_REPO must contain owner/repo");
  return { owner, repo: repo.replace(/\.git$/, "") };
}

function finalAssistantText(sse: string): string {
  let result = "";
  for (const line of sse.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const event = JSON.parse(line.slice(6)) as {
      type?: string;
      role?: string;
      content?: string;
    };
    if (
      event.type === "chat.message" &&
      event.role === "assistant" &&
      typeof event.content === "string"
    ) {
      result = event.content;
    }
  }
  return result;
}

describe.skipIf(!RUN_LIVE)("Brain feature guide live route", () => {
  it("answers a Dashboard Workflow constraint through the real Brain service", async () => {
    const brainUrl = liveBrainUrlOverride ?? process.env.BRAIN_CHAT_URL;
    const brainKey = liveBrainKeyOverride ?? process.env.BRAIN_CHAT_API_KEY;
    const githubToken = process.env.E2E_GITHUB_TOKEN;
    const githubRepo = process.env.E2E_GITHUB_REPO;
    expect(brainUrl, "BRAIN_CHAT_URL is required").toBeTruthy();
    expect(brainKey, "BRAIN_CHAT_API_KEY is required").toBeTruthy();
    expect(githubToken, "E2E_GITHUB_TOKEN is required").toBeTruthy();
    expect(githubRepo, "E2E_GITHUB_REPO is required").toBeTruthy();
    const repo = repoFromUrl(githubRepo!);
    const chatId = `feature-guide-live-${Date.now()}`;
    const tenantId = tenantIdFor(repo.owner, repo.repo);
    const now = new Date().toISOString();
    await getConvexClient().mutation(backendApi.conversations.create, {
      tenantId,
      conversationId: chatId,
      surface: "global",
      scope: { kind: "repository", owner: repo.owner, repo: repo.repo },
      title: "Brain feature guide live test",
      pinned: false,
      activeAgent: { slug: "kody", title: "Kody" },
      runtime: { kind: "brain", brainId: "local-live-test" },
      machineAccess: "brain",
      createdBy: "brain-feature-guide-live-test",
      createdAt: now,
      updatedAt: now,
    });
    const { POST } = await import("../../app/api/kody/chat/brain/route");
    try {
      const response = await POST(
        new NextRequest("https://dashboard.example.test/api/kody/chat/brain", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-brain-url": brainUrl!,
            "x-brain-key": brainKey!,
            "x-kody-token": githubToken!,
            "x-kody-owner": repo.owner,
            "x-kody-repo": repo.repo,
          },
          body: JSON.stringify({
            chatId,
            currentPage: "the Inbox page (/inbox)",
            message:
              "Can a Dashboard Workflow schedule itself nightly? Name the correct alternative and the cycle constraint.",
          }),
        }),
      );

      expect(response.status).toBe(200);
      const answer = finalAssistantText(await response.text());
      expect(answer).toMatch(/cannot|can.?t|does not/i);
      expect(answer).toMatch(/loop|event trigger/i);
      expect(answer).toMatch(/maxIterations|bounded|finite/i);
    } finally {
      await getConvexClient().mutation(backendApi.conversations.remove, {
        tenantId,
        conversationId: chatId,
      });
    }
  }, 300_000);
});
