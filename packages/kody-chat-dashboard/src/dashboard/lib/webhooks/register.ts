import { logger } from "@kody-ade/base/logger";
import { isPublicHttpsUrl } from "./public-url";

export const DEFAULT_WEBHOOK_EVENTS = [
  "issues",
  "issue_comment",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "workflow_run",
  "workflow_job",
  "check_run",
  "check_suite",
  "push",
  "create",
  "delete",
  "discussion",
  "discussion_comment",
  "repository",
  "release",
];

interface GitHubHook {
  id: number;
  config?: { url?: string };
}

export interface EnsureWebhookInput {
  token: string;
  owner: string;
  repo: string;
  hookUrl: string;
  events?: string[];
}

export type EnsureWebhookResult =
  | { ok: true; hookId: number; created: boolean }
  | {
      ok: false;
      skipped: true;
      error: "public_url_required";
      status?: undefined;
      hookId?: undefined;
      detail?: undefined;
    }
  | {
      ok: false;
      skipped?: false;
      error: string;
      status?: number;
      hookId?: number;
      detail?: string;
    };

async function readGithubErrorDetail(
  response: Response,
  token: string,
): Promise<string | undefined> {
  const payload = (await response.json().catch(() => null)) as {
    message?: unknown;
  } | null;
  if (typeof payload?.message !== "string") return undefined;

  const normalized = payload.message.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  const redacted = token
    ? normalized.split(token).join("[redacted]")
    : normalized;
  return redacted.slice(0, 200);
}

function getWebhookSecret(): string | undefined {
  return (
    process.env.GITHUB_WEBHOOK_SECRET?.trim() ||
    process.env.KODY_WEBHOOK_SECRET?.trim() ||
    undefined
  );
}

async function githubRequest(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export async function ensureWebhook(
  input: EnsureWebhookInput,
): Promise<EnsureWebhookResult> {
  const { token, owner, repo, hookUrl } = input;
  const events = input.events?.length ? input.events : DEFAULT_WEBHOOK_EVENTS;

  if (!isPublicHttpsUrl(hookUrl)) {
    return { ok: false, skipped: true, error: "public_url_required" };
  }

  const config = {
    url: hookUrl,
    content_type: "json",
    insecure_ssl: "0",
    ...(getWebhookSecret() ? { secret: getWebhookSecret() } : {}),
  };

  const listRes = await githubRequest(token, `/repos/${owner}/${repo}/hooks`);
  if (!listRes.ok) {
    const detail = await readGithubErrorDetail(listRes, token);
    logger.warn(
      {
        event: "webhook_list_failed",
        status: listRes.status,
        owner,
        repo,
        detail,
      },
      "Failed to list webhooks",
    );
    return {
      ok: false,
      error: "list hooks failed",
      status: listRes.status,
      detail,
    };
  }

  const hooks = (await listRes.json()) as GitHubHook[];
  const existing = hooks.find((hook) => {
    const url = hook?.config?.url;
    if (!url) return false;
    try {
      return new URL(url).pathname === "/api/webhooks/github";
    } catch {
      return false;
    }
  });

  if (existing) {
    const patchRes = await githubRequest(
      token,
      `/repos/${owner}/${repo}/hooks/${existing.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ active: true, events, config }),
      },
    );
    if (!patchRes.ok) {
      const detail = await readGithubErrorDetail(patchRes, token);
      logger.warn(
        {
          event: "webhook_patch_failed",
          status: patchRes.status,
          hookId: existing.id,
          detail,
        },
        "Failed to update webhook",
      );
      return {
        ok: false,
        error: "patch hook failed",
        status: patchRes.status,
        hookId: existing.id,
        detail,
      };
    }
    return { ok: true, hookId: existing.id, created: false };
  }

  const createRes = await githubRequest(
    token,
    `/repos/${owner}/${repo}/hooks`,
    {
      method: "POST",
      body: JSON.stringify({ name: "web", active: true, events, config }),
    },
  );
  if (!createRes.ok) {
    const detail = await readGithubErrorDetail(createRes, token);
    logger.warn(
      {
        event: "webhook_create_failed",
        status: createRes.status,
        owner,
        repo,
        detail,
      },
      "Failed to create webhook",
    );
    return {
      ok: false,
      error: "create hook failed",
      status: createRes.status,
      detail,
    };
  }

  const created = (await createRes.json()) as GitHubHook;
  return { ok: true, hookId: created.id, created: true };
}
