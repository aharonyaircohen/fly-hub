/**
 * @fileType utility
 * @domain kody
 * @pattern dashboard-deep-link
 * @ai-summary Maps a GitHub issue/PR `html_url` to the equivalent in-app
 *   dashboard task route (`/repo/:owner/:repo/:number` when the repo is known,
 *   otherwise legacy `/<number>`) so notifications and chat links open inside
 *   Kody instead of github.com.
 *
 *   Dashboard targets are returned as ROOT-RELATIVE paths
 *   (`/repo/owner/repo/123`, `/messages?...`). They end up in a web-push
 *   payload and are resolved by the service worker against its own registration
 *   origin — i.e. the
 *   actually-deployed domain — so this works on every deployment with no
 *   `NEXT_PUBLIC_SERVER_URL` config. Cross-origin github.com URLs (with
 *   no clean dashboard mapping) are still returned absolute, unchanged.
 *
 *   Issues and PRs share the dashboard task page because GitHub uses a shared
 *   number pool for both — the page renders whichever artifact owns that
 *   number. Discussion and commit URLs have no equivalent dashboard route, so
 *   their GitHub URL is returned unchanged (callers fall back to github.com,
 *   preserving anchors there).
 */
import "server-only";

import { routes, type RepoRef } from "@kody-ade/base/routes";

// Matches a GitHub issue/PR html_url. Covers:
//   https://github.com/owner/repo/issues/123
//   https://github.com/owner/repo/issues/123#issuecomment-456
//   https://github.com/owner/repo/pull/123
//   https://github.com/owner/repo/pull/123#issuecomment-456
//   https://github.com/owner/repo/pull/123#discussion_r789
//   https://github.com/owner/repo/pull/123#pullrequestreview-789
const TASK_URL_RE =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)(?:[#?/].*)?$/;

type DashboardTaskRepo = RepoRef | string | null | undefined;

function normalizeRepoRef(repo: DashboardTaskRepo): RepoRef | null {
  if (!repo) return null;
  if (typeof repo !== "string") return repo;
  const [owner, repoName, extra] = repo.split("/");
  if (!owner || !repoName || extra) return null;
  return { owner, repo: repoName };
}

/** Root-relative dashboard task page for an issue or PR number. */
export function dashboardTaskUrl(
  threadNumber: number,
  repo?: DashboardTaskRepo,
): string {
  const repoRef = normalizeRepoRef(repo);
  if (repoRef) return routes.repoTask(repoRef, threadNumber);
  return `/${threadNumber}`;
}

/** Root-relative dashboard file page for a connected-repo path. */
export function dashboardFileUrl(path: string | undefined): string {
  const normalized = (path ?? "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
  if (!normalized) return "/files";
  return `/files/${normalized.split("/").map(encodeURIComponent).join("/")}`;
}

function dashboardSlugUrl(basePath: string, slug: string | undefined): string {
  const normalized = (slug ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!normalized) return basePath;
  return `${basePath}/${encodeURIComponent(normalized)}`;
}

export function dashboardMemoryUrl(id: string | undefined): string {
  return dashboardSlugUrl("/memory", id);
}

export function dashboardContextUrl(slug: string | undefined): string {
  return dashboardSlugUrl("/context", slug);
}

export function dashboardCapabilityUrl(slug: string | undefined): string {
  return dashboardSlugUrl("/capabilities", slug);
}

export function dashboardTodoUrl(slug: string | undefined): string {
  return dashboardSlugUrl("/todos", slug);
}

export function dashboardAgentUrl(slug: string | undefined): string {
  return dashboardSlugUrl("/agents", slug);
}

export function dashboardCommandUrl(_slug?: string | undefined): string {
  return "/commands";
}

export function dashboardInstructionsUrl(): string {
  return "/instructions";
}

/**
 * Return the dashboard URL for an Issue/PR thread, or the original GitHub
 * URL for thread types with no in-app view (Discussion, Commit) or when
 * the URL shape is unexpected.
 */
export function dashboardThreadUrl(opts: {
  githubUrl: string | undefined;
  threadType: string;
}): string {
  const githubUrl = opts.githubUrl ?? "";
  if (opts.threadType !== "Issue" && opts.threadType !== "PullRequest") {
    return githubUrl;
  }

  const m = githubUrl.match(TASK_URL_RE);
  if (!m) return githubUrl;

  return dashboardTaskUrl(Number(m[3]), { owner: m[1], repo: m[2] });
}

/**
 * Dashboard deep link for a messaging-channel comment. Channels are
 * `#`-titled Discussions surfaced in the in-app `/messages` view, so push
 * + inbox entries open the channel scrolled to the message rather than
 * github.com. `c` is the comment's REST `databaseId` — `MessagesView`
 * matches it to scroll/highlight.
 */
export function dashboardChannelUrl(opts: {
  channelNumber: number;
  commentId?: number;
}): string {
  const q = opts.commentId
    ? `?channel=${opts.channelNumber}&c=${opts.commentId}`
    : `?channel=${opts.channelNumber}`;
  return `/messages${q}`;
}
