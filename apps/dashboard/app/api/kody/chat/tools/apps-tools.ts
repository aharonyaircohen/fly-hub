import crypto from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import { NextRequest } from "next/server";
import {
  GET as listApps,
  POST as createApp,
} from "@kody-ade/kody-chat-dashboard/routes/kody/apps";
import { POST as inspectApp } from "@kody-ade/kody-chat-dashboard/routes/kody/apps-inspect";
import {
  GET as readApp,
  PATCH as updateApp,
  DELETE as deleteApp,
} from "@kody-ade/kody-chat-dashboard/routes/kody/apps-detail";
import { POST as appAction } from "@kody-ade/kody-chat-dashboard/routes/kody/apps-actions";
import { GET as readLogs } from "@kody-ade/kody-chat-dashboard/routes/kody/apps-logs";
import { POST as deployments } from "@kody-ade/kody-chat-dashboard/routes/kody/apps-deployments";

const plan = z.object({
  kind: z.string(),
  rootDirectory: z.string(),
  buildCommand: z.string().optional(),
  startCommand: z.string().optional(),
  port: z.number().int().optional(),
  imageRef: z.string().optional(),
  dockerfilePath: z.string().optional(),
  dockerBuildTarget: z.string().optional(),
  runtimeEnv: z.record(z.string(), z.string()).optional(),
  generatedSecretNames: z.array(z.string()).optional(),
});
function request(
  opts: { token: string; owner: string; repo: string },
  path: string,
  method = "GET",
  body?: unknown,
) {
  return new NextRequest(`http://kody.local${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-kody-token": opts.token,
      "x-kody-owner": opts.owner,
      "x-kody-repo": opts.repo,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function output(response: Response) {
  const body = await response
    .json()
    .catch(() => ({ error: `HTTP ${response.status}` }));
  return response.ok ? body : { ...(body as object), status: response.status };
}
export function createAppsTools(opts: {
  token: string;
  owner: string;
  repo: string;
}) {
  return {
    list_apps: tool({
      description: "List repository Apps and their observed runtime status.",
      inputSchema: z.object({}),
      execute: async () =>
        output(await listApps(request(opts, "/api/kody/apps"))),
    }),
    read_app: tool({
      description:
        "Read one App's safe configuration, deployments links, access-token names, domains, and storage. Secret values and token hashes are never returned.",
      inputSchema: z.object({ slug: z.string() }),
      execute: async ({ slug }) =>
        output(
          await readApp(
            request(opts, `/api/kody/apps/${encodeURIComponent(slug)}`),
            { params: Promise.resolve({ slug }) },
          ),
        ),
    }),
    inspect_app_source: tool({
      description:
        "Read-only inspection of a GitHub repository supplied by the user, or the current repository when none is supplied. Detects the App root, exact commit, build command, start command, and port. Use before proposing setup.",
      inputSchema: z.object({
        repository: z.string().optional(),
        rootDirectory: z.string().optional(),
        ref: z.string().optional(),
        name: z.string().optional(),
      }),
      execute: async (input) =>
        output(
          await inspectApp(
            request(opts, "/api/kody/apps/inspect", "POST", input),
          ),
        ),
    }),
    prepare_app_setup: tool({
      description:
        "Prepare the exact read-only App setup summary the user must approve. Does not deploy or mutate anything.",
      inputSchema: z.object({
        repository: z.string().optional(),
        rootDirectory: z.string().optional(),
        ref: z.string().optional(),
        name: z.string().optional(),
      }),
      execute: async (input) =>
        output(
          await inspectApp(
            request(opts, "/api/kody/apps/inspect", "POST", input),
          ),
        ),
    }),
    create_app: tool({
      description:
        "Create and asynchronously deploy an inspected App. The server re-inspects the pinned repository commit and uses that authoritative configuration, even if the submitted plan or secret list is stale. Requires explicit approval; report status as started until verification completes.",
      inputSchema: z.object({
        repository: z.string(),
        name: z.string(),
        slug: z.string(),
        ref: z.string(),
        commitSha: z.string(),
        plan,
        secretNames: z.array(z.string()).default([]),
      }),
      execute: async (input) =>
        output(
          await createApp(
            request(opts, "/api/kody/apps", "POST", {
              ...input,
              requestId: crypto.randomUUID(),
            }),
          ),
        ),
    }),
    manage_app: tool({
      description:
        "Start, stop, restart, redeploy, roll back, or delete an App. Every mutation requires explicit approval.",
      inputSchema: z.discriminatedUnion("action", [
        z.object({
          slug: z.string(),
          action: z.enum(["start", "stop", "restart"]),
        }),
        z.object({
          slug: z.string(),
          action: z.literal("deploy"),
          commitSha: z.string(),
        }),
        z.object({
          slug: z.string(),
          action: z.literal("rollback"),
          deploymentId: z.string(),
        }),
        z.object({
          slug: z.string(),
          action: z.literal("delete"),
          deleteStorage: z.boolean().default(false),
        }),
      ]),
      execute: async (input) => {
        const slug = input.slug;
        if (input.action === "delete")
          return output(
            await deleteApp(
              request(opts, `/api/kody/apps/${slug}`, "DELETE", {
                deleteStorage: input.deleteStorage,
              }),
              { params: Promise.resolve({ slug }) },
            ),
          );
        if (input.action === "deploy" || input.action === "rollback")
          return output(
            await deployments(
              request(opts, `/api/kody/apps/${slug}/deployments`, "POST", {
                requestId: crypto.randomUUID(),
                ...(input.action === "deploy"
                  ? { commitSha: input.commitSha }
                  : { rollbackDeploymentId: input.deploymentId }),
              }),
              { params: Promise.resolve({ slug }) },
            ),
          );
        return output(
          await appAction(
            request(opts, `/api/kody/apps/${slug}/actions`, "POST", {
              action: input.action,
            }),
            { params: Promise.resolve({ slug }) },
          ),
        );
      },
    }),
    update_app: tool({
      description:
        "Update App settings or access. Exposure changes perform a controlled redeploy. Requires explicit approval.",
      inputSchema: z.object({
        slug: z.string(),
        name: z.string().optional(),
        branch: z.string().optional(),
        exposure: z.enum(["private", "public"]).optional(),
      }),
      execute: async ({ slug, ...input }) =>
        output(
          await updateApp(
            request(opts, `/api/kody/apps/${slug}`, "PATCH", input),
            { params: Promise.resolve({ slug }) },
          ),
        ),
    }),
    read_app_logs: tool({
      description: "Read recent redacted operational logs for one App.",
      inputSchema: z.object({
        slug: z.string(),
        cursor: z.string().optional(),
      }),
      execute: async ({ slug, cursor }) =>
        output(
          await readLogs(
            request(
              opts,
              `/api/kody/apps/${slug}/logs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
            ),
            { params: Promise.resolve({ slug }) },
          ),
        ),
    }),
  };
}
