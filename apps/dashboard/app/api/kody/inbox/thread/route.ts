/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern inbox-thread-api
 * @ai-summary Resolves a single inbox entry's GitHub thread (Issue or PR)
 *   into renderable content so the dashboard can show it inline instead of
 *   bouncing the user to github.com. Reuses the already-cached
 *   `fetchIssue` + `fetchPRComments` helpers — this endpoint is hit
 *   on-demand (one click), never polled, so it adds no rate-limit pressure.
 *   Discussions/Commits/Releases are intentionally unsupported; the client
 *   falls back to opening github.com for those.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { handleKodyApiError } from "@dashboard/lib/github-error-handler";
import { requireKodyAuth, getRequestAuth } from "@kody-ade/base/auth";
import {
  fetchIssue,
  fetchPRComments,
  fetchDiscussionThread,
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";

const getSchema = z.object({
  type: z.enum(["Issue", "PullRequest", "Discussion"]),
  number: z.coerce.number().int().positive(),
  /** `owner/repo` of the thread when it is not the connected repo.
   * Fetched with the same user token. */
  repo: z
    .string()
    .regex(/^[^/\s]+\/[^/\s]+$/)
    .optional(),
});

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const { searchParams } = new URL(req.url);
    const parsed = getSchema.safeParse({
      type: searchParams.get("type"),
      number: searchParams.get("number"),
      repo: searchParams.get("repo") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid type/number", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { type, number, repo } = parsed.data;
    if (repo && headerAuth) {
      const [threadOwner, threadRepo] = repo.split("/") as [string, string];
      setGitHubContext(threadOwner, threadRepo, headerAuth.token);
    }

    // Discussion threads use GraphQL but share the same
    // normalized response shape so the client renders them identically.
    if (type === "Discussion") {
      const d = await fetchDiscussionThread(number);
      if (!d) {
        return NextResponse.json(
          { error: "Thread not found" },
          { status: 404 },
        );
      }
      return NextResponse.json({
        thread: {
          title: d.title,
          body: d.body,
          state: d.state,
          htmlUrl: d.htmlUrl,
          createdAt: d.createdAt,
          comments: d.comments.map((c) => ({
            id: c.databaseId,
            body: c.body,
            created_at: c.createdAt,
            user: {
              login: c.author?.login ?? "ghost",
              type: "User" as const,
              avatar_url: c.author?.avatarUrl ?? "",
            },
          })),
        },
      });
    }

    // PRs are issues under the hood — issues.get / issues.listComments
    // resolve the body + conversation thread for both.
    const [issue, comments] = await Promise.all([
      fetchIssue(number),
      fetchPRComments(number),
    ]);

    if (!issue) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    return NextResponse.json({
      thread: {
        title: issue.title,
        body: issue.body ?? "",
        state: issue.state,
        htmlUrl: issue.html_url,
        createdAt: issue.created_at,
        comments: comments.map((c) => ({
          id: c.id,
          body: c.body,
          created_at: c.created_at,
          user: {
            login: c.user.login,
            type: "User" as const,
            avatar_url: c.user.avatar_url,
          },
        })),
      },
    });
  } catch (error: unknown) {
    return handleKodyApiError(error, "inbox-thread");
  } finally {
    clearGitHubContext();
  }
}
