import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
  verifyActorLogin,
} from "@kody-ade/base/auth";
import { startAgencyRequest } from "@kody-ade/agency/agency-request-lifecycle";
import { readTodoFile, writeTodoFile } from "@kody-ade/workspace/todos/files";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@kody-ade/workspace/github";
import {
  dispatchApprovedAgencyWorkflow,
  prepareApprovedAgencyExecution,
} from "@dashboard/features/agency/server/approved-agency-workflow";
import { createCompanyWorkflowLoader } from "@dashboard/features/workflows/server/company-workflow-loader";
import { createGitHubActionsEngineGateway } from "@dashboard/features/workflows/server/github-actions-engine-gateway";
import {
  validateWorkflowDefinition,
  validateWorkflowInput,
} from "@dashboard/lib/workflow-definitions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TODO_SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  const { slug } = await params;
  if (!TODO_SLUG.test(slug)) {
    return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
  }

  setGitHubContext(auth.owner, auth.repo, auth.token);
  try {
    const actorResult = await verifyActorLogin(req, undefined);
    if (actorResult instanceof NextResponse) return actorResult;
    const actor = `github:${actorResult.identity.githubId}`;
    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }
    const result = await startAgencyRequest(slug, {
      read: async (requestSlug) => {
        const todo = await readTodoFile(requestSlug);
        return todo?.agencyRequest
          ? { slug: todo.slug, state: todo.agencyRequest }
          : null;
      },
      save: async (requestSlug, state) => {
        const todo = await readTodoFile(requestSlug);
        if (!todo) throw new Error("Agency request Todo was not found");
        await writeTodoFile({
          octokit,
          slug: requestSlug,
          title: todo.title,
          description: todo.description,
          items: todo.items,
          createdAt: todo.createdAt,
          frontmatter: todo.frontmatter,
          agencyRequest: state,
          sha: todo.sha,
        });
      },
      prepare: (execution) =>
        prepareApprovedAgencyExecution(execution, async (activation) => {
          const headers = new Headers(req.headers);
          headers.set("content-type", "application/json");
          headers.delete("content-length");
          for (const name of [
            "connection",
            "keep-alive",
            "proxy-authenticate",
            "proxy-authorization",
            "te",
            "trailer",
            "transfer-encoding",
            "upgrade",
          ]) {
            headers.delete(name);
          }
          const response = await fetch(
            new URL("/api/kody/store-catalog/import", req.url),
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                kind: activation.kind,
                slug: activation.id,
                actorLogin: actorResult.identity.login,
                repositoryWriteMode: "defer",
              }),
            },
          );
          if (!response.ok) {
            const payload = (await response.json().catch(() => ({}))) as {
              message?: string;
            };
            throw new Error(
              payload.message ??
                `Could not activate ${activation.kind}:${activation.id}`,
            );
          }
          const payload = (await response.json()) as {
            configPatch?: Record<string, unknown>;
            files?: Array<{ path: string; content: string }>;
          };
          return {
            configPatch: payload.configPatch,
            files: payload.files,
          };
        }),
      createRunId: () => `run-${randomUUID()}`,
      dispatch: (execution, runId) =>
        dispatchApprovedAgencyWorkflow({
          actor,
          execution,
          runId,
          services: {
            loadWorkflow: createCompanyWorkflowLoader({
              octokit,
              owner: auth.owner,
              repo: auth.repo,
              syncStoreDefinitions: true,
              allowedStoreWorkflowIds: new Set([execution.workflowId]),
            }),
            validateDefinition: validateWorkflowDefinition,
            validateInput: (schema, input) =>
              validateWorkflowInput(input, schema),
            dispatch: createGitHubActionsEngineGateway({
              octokit,
              owner: auth.owner,
              repo: auth.repo,
            }),
          },
        }),
    });

    if (result.kind === "not-found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (result.kind === "invalid-phase" || result.kind === "blocked") {
      return NextResponse.json(result, { status: 409 });
    }
    return NextResponse.json(result, {
      status: result.kind === "started" ? 202 : 200,
    });
  } catch (error) {
    console.error("[Agency request run] failed", error);
    return NextResponse.json(
      { error: "agency_request_run_failed" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
