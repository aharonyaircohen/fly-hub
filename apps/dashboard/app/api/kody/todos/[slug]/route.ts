import { createHash } from "node:crypto";
import { NextRequest } from "next/server";

import { getRequestAuth, getUserOctokit } from "@kody-ade/base/auth";
import {
  DELETE as deleteTodo,
  GET as getTodo,
  PATCH as patchTodo,
} from "@kody-ade/workspace/routes/todos-slug";
import { appendInboxEntries } from "@dashboard/lib/inbox/convex-store";

export const GET = getTodo;
export const DELETE = deleteTodo;

type RouteContext = { params: Promise<{ slug: string }> };

export async function PATCH(req: NextRequest, context: RouteContext) {
  const notificationPayload = req
    .clone()
    .json()
    .catch(() => null) as Promise<{
    agencyRequest?: { phase?: unknown; questions?: unknown };
  } | null>;
  const response = await patchTodo(req, context);
  if (!response.ok) return response;

  try {
    const payload = await notificationPayload;
    const questions = payload?.agencyRequest?.questions;
    if (
      payload?.agencyRequest?.phase !== "waiting-information" ||
      !Array.isArray(questions) ||
      questions.length === 0 ||
      questions.some((question) => typeof question !== "string")
    ) {
      return response;
    }

    const auth = getRequestAuth(req);
    const octokit = await getUserOctokit(req);
    if (!auth || !octokit) return response;
    const { slug } = await context.params;
    const result = (await response.clone().json()) as {
      todo?: { title?: unknown };
    };
    const title =
      typeof result.todo?.title === "string"
        ? result.todo.title
        : "Agency request";
    const snippet = questions.join(" ").trim().slice(0, 240);
    const questionId = createHash("sha256")
      .update(questions.join("\n"))
      .digest("hex")
      .slice(0, 16);
    const url = new URL(
      `/repo/${encodeURIComponent(auth.owner)}/${encodeURIComponent(auth.repo)}/todos/${encodeURIComponent(slug)}`,
      req.url,
    ).toString();
    await appendInboxEntries(octokit, auth.owner, auth.repo, [
      {
        id: `agency-request-question:${slug}:${questionId}`,
        source: "kody",
        repoFullName: `${auth.owner}/${auth.repo}`,
        threadType: "AgencyRequest",
        title: `Kody needs your decision: ${title}`,
        snippet,
        url,
        sentAt: new Date().toISOString(),
        readAt: null,
        category: "gate-waiting",
      },
    ]);
  } catch (error) {
    console.error("[Agency request] Inbox delivery failed", error);
  }
  return response;
}
