import type { z } from "zod";
import type {
  ChatPluginServerTools,
  ChatPluginToolDefinition,
  ChatToolServerContext,
} from "@kody-ade/kody-chat-dashboard/platform";
import { getChatServerToolRegistry } from "@kody-ade/kody-chat-dashboard/platform/server-tools";
import { createUserOctokit } from "@dashboard/lib/github-client";
import { createCompanyTools } from "../tools/company-tools";
import { createInboxTools } from "../tools/inbox-tools";
import { createMacroTools } from "../tools/macros-tools";
import { createNotificationTools } from "../tools/notifications-tools";
import { createRemoteTools } from "../tools/remote-tools";
import { createReportTools } from "../tools/reports-tools";
import { createAppsTools } from "../tools/apps-tools";

const DASHBOARD_HOST_PLUGIN_ID = "dashboard-host";

type AiSdkTool = {
  description?: string;
  inputSchema: z.ZodTypeAny;
  execute?: (input: never, options: never) => unknown;
};

function actorLoginFrom(ctx: ChatToolServerContext): string | null {
  const actorLogin = ctx.extras?.actorLogin;
  return typeof actorLogin === "string" && actorLogin.trim()
    ? actorLogin.trim()
    : null;
}

function adaptTools(
  tools: Record<string, unknown>,
): Record<string, ChatPluginToolDefinition> {
  return Object.fromEntries(
    Object.entries(tools).map(([name, candidate]) => {
      const definition = candidate as AiSdkTool;
      if (!definition.inputSchema || typeof definition.execute !== "function") {
        throw new Error(`Dashboard host tool "${name}" is not executable`);
      }
      return [
        name,
        {
          description: definition.description ?? "",
          inputSchema: definition.inputSchema,
          execute: async (input: unknown) =>
            definition.execute!(
              input as never,
              {
                toolCallId: `dashboard-host:${name}`,
                messages: [],
              } as never,
            ),
        },
      ];
    }),
  );
}

export const createDashboardHostTools: ChatPluginServerTools = (ctx) => {
  const actorLogin = actorLoginFrom(ctx);
  const octokit = createUserOctokit(ctx.token);
  return adaptTools({
    ...createAppsTools({ token: ctx.token, owner: ctx.owner, repo: ctx.repo }),
    ...createMacroTools({
      octokit,
      owner: ctx.owner,
      repo: ctx.repo,
      actorLogin,
    }),
    ...createNotificationTools({ owner: ctx.owner, repo: ctx.repo }),
    ...createCompanyTools({
      octokit,
      owner: ctx.owner,
      repo: ctx.repo,
      actorLogin,
    }),
    ...createInboxTools({ octokit, owner: ctx.owner, repo: ctx.repo }),
    ...createReportTools({ owner: ctx.owner, repo: ctx.repo }),
    ...createRemoteTools(actorLogin),
  });
};

const registry = getChatServerToolRegistry();
if (!registry.pluginIds().includes(DASHBOARD_HOST_PLUGIN_ID)) {
  registry.register(DASHBOARD_HOST_PLUGIN_ID, createDashboardHostTools);
}
