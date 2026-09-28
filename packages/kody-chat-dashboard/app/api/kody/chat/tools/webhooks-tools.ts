/**
 * @fileType util
 * @domain webhooks
 * @pattern chat-tools
 * @ai-summary Chat tool to register/refresh the GitHub webhook for the
 *   connected repo (points at /api/webhooks/github). Idempotent via the
 *   shared ensureWebhook helper. Needs the raw PAT (not just an octokit), so
 *   it's wired with repo.token explicitly.
 */
import { tool } from "ai";
import { z } from "zod";
import { ensureWebhook } from "../../../../../src/dashboard/lib/webhooks/register";

interface Ctx {
  token: string;
  owner: string;
  repo: string;
  hookUrl: string;
}

export function createWebhookTools(ctx: Ctx) {
  const { token, owner, repo, hookUrl } = ctx;
  const repoRef = `${owner}/${repo}`;
  return {
    register_webhook: tool({
      description: `Register or refresh the GitHub webhook on ${repoRef} so the dashboard receives push-based cache invalidation and workflow events. Idempotent — safe to call repeatedly. The dashboard URL is taken from the current request; the token still needs repository webhook write permission.`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const result = await ensureWebhook({
            token,
            owner,
            repo,
            hookUrl,
          });
          return result;
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
