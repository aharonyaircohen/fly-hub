/**
 * @fileType utility
 * @domain kody
 * @pattern github-client
 * @ai-summary GitHub Discussions for messaging channels (GraphQL only, cached + in-flight dedup).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Octokit } from "@octokit/rest";
import { slugifyTitle } from "../slug";
import {
  getCached,
  getStale,
  setCache,
  getOctokit,
  getOwner,
  getRepo,
  invalidateCache,
} from "./core";
// ============ Discussions ============
//
// Comments live as native discussion comments —
// threading, reactions, edits all come for free.
//
// All discussion ops are GraphQL only (no REST). GraphQL has no ETag/304 path,
// so the rate-limit story matches `fetchOpenPRs`: TTL cache + in-flight dedup
// + stale-on-error refresh.

export interface DiscussionComment {
  id: string;
  databaseId: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  author: { login: string; avatarUrl?: string } | null;
}

export interface DiscussionRef {
  /** GraphQL node ID (used for comment mutations). */
  id: string;
  /** Numeric discussion number, for the github.com URL. */
  number: number;
  url: string;
  commentsCount: number;
}

interface RepoDiscussionMeta {
  enabled: boolean;
  /**
   * GraphQL node ID for the discussion category channels will be filed
   * under. Picks (in order of preference): "General" (the default catch-all created
   * automatically when Discussions are enabled), then the first non-
   * announcements category, then any. Null only if no categories exist
   * (Discussions disabled, or all categories deleted manually).
   */
  categoryId: string | null;
  /** Display name of the chosen category, for diagnostics. */
  categoryName: string | null;
}

const DISCUSSIONS_META_TTL = 10 * 60_000; // 10min — flips rarely, webhook invalidates
const DISCUSSION_COMMENTS_TTL = 60_000; // 1min — UI-driven re-reads

/**
 * Names tried in order when picking the discussion category. The first match
 * wins. The dashboard never *creates* a
 * category — GitHub doesn't expose category creation in any public API —
 * so we rely on the defaults that get seeded when Discussions is enabled.
 *
 * Power users can opt into a dedicated bucket by using any preferred-list
 * name on github.com.
 */
const PREFERRED_CATEGORY_NAMES = ["General", "Ideas", "Show and tell"];

const inflightDiscussionsMeta = new Map<string, Promise<RepoDiscussionMeta>>();
const inflightDiscussionComments = new Map<
  string,
  Promise<DiscussionComment[]>
>();

/**
 * Pick the best discussion category, given the
 * repo's actual category list. Walks the preferred-name list first, then
 * falls back to the first non-announcements category, then any.
 */
function pickCategory(
  cats: { id: string; name: string }[],
): { id: string; name: string } | null {
  if (cats.length === 0) return null;
  for (const preferred of PREFERRED_CATEGORY_NAMES) {
    const hit = cats.find(
      (c) => c.name.toLowerCase() === preferred.toLowerCase(),
    );
    if (hit) return hit;
  }
  const nonAnnouncements = cats.find(
    (c) => !c.name.toLowerCase().includes("announce"),
  );
  return nonAnnouncements ?? cats[0];
}

/**
 * Wipe discussion caches. Called from the webhook receiver on `discussion`,
 * `discussion_comment`, and `repository` events. Also clears the messaging
 * channels cache, since channels are Discussions in the same category and a
 * new/edited discussion changes the channel list and ordering.
 */
export function invalidateDiscussionCache(): void {
  invalidateCache("discussions-meta:");
  invalidateCache("discussion-comments:");
  invalidateCache("message-channels:");
}

/**
 * Read the repo's discussion capability metadata: whether Discussions are
 * enabled at all, and (if so) the GraphQL node ID of its preferred category.
 *
 * Caches the result for 10min in-process. Cross-instance cache is not needed
 * because the value flips at most once per repo lifecycle.
 */
export async function fetchRepoDiscussionMeta(): Promise<RepoDiscussionMeta> {
  const cacheKey = `discussions-meta:${getOwner()}:${getRepo()}`;
  const cached = getCached<RepoDiscussionMeta>(cacheKey);
  if (cached) return cached;

  const existing = inflightDiscussionsMeta.get(cacheKey);
  if (existing) return existing;

  const stale = getStale<RepoDiscussionMeta>(cacheKey);
  const octokit = getOctokit();

  const query = `
    query RepoDiscussionMeta($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        hasDiscussionsEnabled
        discussionCategories(first: 25) {
          nodes { id name }
        }
      }
    }
  `;

  const promise = (async () => {
    try {
      const data = await octokit.graphql<{
        repository: {
          hasDiscussionsEnabled: boolean;
          discussionCategories: {
            nodes: { id: string; name: string }[];
          } | null;
        };
      }>(query, { owner: getOwner(), repo: getRepo() });

      const enabled = !!data.repository.hasDiscussionsEnabled;
      const cats = data.repository.discussionCategories?.nodes ?? [];
      const chosen = pickCategory(cats);

      const meta: RepoDiscussionMeta = {
        enabled,
        categoryId: enabled && chosen ? chosen.id : null,
        categoryName: enabled && chosen ? chosen.name : null,
      };
      setCache(cacheKey, DISCUSSIONS_META_TTL, meta);
      return meta;
    } catch (err) {
      if (stale) {
        // Refresh TTL on stale to dampen GraphQL throttling under load.
        setCache(cacheKey, Math.min(DISCUSSIONS_META_TTL, 60_000), stale.data);
        return stale.data;
      }
      throw err;
    } finally {
      inflightDiscussionsMeta.delete(cacheKey);
    }
  })();

  inflightDiscussionsMeta.set(cacheKey, promise);
  return promise;
}

/**
 * Outcome of a `enableRepoDiscussions` call. The caller surfaces these
 * states to the UI to drive the disabled-badge copy.
 */
export type EnableDiscussionsOutcome =
  | { ok: true; alreadyEnabled: boolean }
  | {
      ok: false;
      reason: "forbidden" | "unknown";
      status?: number;
      message?: string;
    };

/**
 * Idempotently turn on Discussions for the current repo. Uses the user PAT
 * (must be repo admin) — never the shared polling token, since this is a
 * permission-sensitive write that should be attributed to the human.
 *
 * Returns `{ ok: true, alreadyEnabled: true }` as a fast path when the
 * cached meta already says it's on (no API call). On 403 we report
 * `forbidden` so the UI can prompt the user to ask an admin.
 *
 * Cache: invalidates the discussions-meta cache on success so the next
 * read sees the new state without waiting for the 10-minute TTL.
 */
export async function enableRepoDiscussions(
  userOctokit: Octokit,
): Promise<EnableDiscussionsOutcome> {
  // Cheap pre-check: if cached meta already says enabled, skip the PATCH.
  const cached = getCached<RepoDiscussionMeta>(
    `discussions-meta:${getOwner()}:${getRepo()}`,
  );
  if (cached?.enabled) {
    return { ok: true, alreadyEnabled: true };
  }

  try {
    await userOctokit.request("PATCH /repos/{owner}/{repo}", {
      owner: getOwner(),
      repo: getRepo(),
      has_discussions: true,
    });
    invalidateDiscussionCache();
    return { ok: true, alreadyEnabled: false };
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 403 || e.status === 401 || e.status === 404) {
      // 404 from PATCH typically means "you don't have admin rights to see
      // this endpoint on this repo" — treat as forbidden for UX purposes.
      return {
        ok: false,
        reason: "forbidden",
        status: e.status,
        message: e.message,
      };
    }
    return {
      ok: false,
      reason: "unknown",
      status: e.status,
      message: e.message,
    };
  }
}

/**
 * Look up the GraphQL repository ID. Cached forever per (owner,repo) — IDs
 * never change.
 */
const repoIdCache = new Map<string, string>();
export async function fetchRepositoryId(): Promise<string> {
  const key = `${getOwner()}/${getRepo()}`;
  const hit = repoIdCache.get(key);
  if (hit) return hit;
  const octokit = getOctokit();
  const data = await octokit.graphql<{ repository: { id: string } }>(
    `query RepoId($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { id } }`,
    { owner: getOwner(), repo: getRepo() },
  );
  repoIdCache.set(key, data.repository.id);
  return data.repository.id;
}

/**
 * Create a discussion under the preferred category and return its IDs.
 *
 * Uses `userOctokit` so the discussion is attributed to the human who
 * triggered the create — never the shared polling token.
 */
export async function createDiscussion(
  args: {
    title: string;
    body: string;
    categoryId: string;
  },
  userOctokit?: Octokit,
): Promise<DiscussionRef> {
  const octokit = userOctokit ?? getOctokit();
  const repoId = await fetchRepositoryId();

  const data = await octokit.graphql<{
    createDiscussion: {
      discussion: {
        id: string;
        number: number;
        url: string;
        comments: { totalCount: number };
      };
    };
  }>(
    `mutation CreateDiscussion(
       $repoId: ID!,
       $categoryId: ID!,
       $title: String!,
       $body: String!
     ) {
       createDiscussion(input: {
         repositoryId: $repoId,
         categoryId: $categoryId,
         title: $title,
         body: $body
       }) {
         discussion {
           id
           number
           url
           comments(first: 0) { totalCount }
         }
       }
     }`,
    {
      repoId,
      categoryId: args.categoryId,
      title: args.title,
      body: args.body,
    },
  );
  const d = data.createDiscussion.discussion;
  invalidateDiscussionCache();
  return {
    id: d.id,
    number: d.number,
    url: d.url,
    commentsCount: d.comments.totalCount,
  };
}

/**
 * Update a discussion title/body.
 */
export async function updateDiscussion(
  args: { discussionId: string; title?: string; body?: string },
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit();
  const updates: Record<string, unknown> = { discussionId: args.discussionId };
  if (typeof args.title === "string") updates.title = args.title;
  if (typeof args.body === "string") updates.body = args.body;
  if (Object.keys(updates).length === 1) return; // nothing to change

  await octokit.graphql(
    `mutation UpdateDiscussion($discussionId: ID!, $title: String, $body: String) {
       updateDiscussion(input: { discussionId: $discussionId, title: $title, body: $body }) {
         discussion { id }
       }
     }`,
    updates,
  );
  invalidateDiscussionCache();
}

/**
 * Close (lock) a discussion without deleting its history.
 */
export async function closeDiscussion(
  discussionId: string,
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit();
  try {
    await octokit.graphql(
      `mutation CloseDiscussion($discussionId: ID!) {
         closeDiscussion(input: { discussionId: $discussionId, reason: RESOLVED }) {
           discussion { id }
         }
       }`,
      { discussionId },
    );
  } catch {
    // Older repos / permission limits — non-fatal.
  }
  invalidateDiscussionCache();
}

/**
 * Fetch comments on a discussion. Cached + in-flight-deduped + stale-
 * on-error, mirroring the `fetchOpenPRs` pattern (GraphQL has no ETag).
 */
export async function fetchDiscussionComments(
  discussionNumber: number,
): Promise<DiscussionComment[]> {
  const cacheKey = `discussion-comments:${getOwner()}:${getRepo()}:${discussionNumber}`;
  const cached = getCached<DiscussionComment[]>(cacheKey);
  if (cached) return cached;

  const existing = inflightDiscussionComments.get(cacheKey);
  if (existing) return existing;

  const stale = getStale<DiscussionComment[]>(cacheKey);
  const octokit = getOctokit();

  const query = `
    query DiscussionComments($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        discussion(number: $number) {
          comments(first: 100) {
            nodes {
              id
              databaseId
              body
              createdAt
              updatedAt
              url
              author { login avatarUrl }
            }
          }
        }
      }
    }
  `;

  const promise = (async () => {
    try {
      const data = await octokit.graphql<{
        repository: {
          discussion: {
            comments: {
              nodes: {
                id: string;
                databaseId: number;
                body: string;
                createdAt: string;
                updatedAt: string;
                url: string;
                author: { login: string; avatarUrl?: string } | null;
              }[];
            };
          } | null;
        };
      }>(query, {
        owner: getOwner(),
        repo: getRepo(),
        number: discussionNumber,
      });

      const nodes = data.repository.discussion?.comments.nodes ?? [];
      const comments: DiscussionComment[] = nodes.map((n) => ({
        id: n.id,
        databaseId: n.databaseId,
        body: n.body ?? "",
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        url: n.url,
        author: n.author
          ? { login: n.author.login, avatarUrl: n.author.avatarUrl }
          : null,
      }));
      setCache(cacheKey, DISCUSSION_COMMENTS_TTL, comments);
      return comments;
    } catch (err) {
      if (stale) {
        setCache(
          cacheKey,
          Math.min(DISCUSSION_COMMENTS_TTL, 30_000),
          stale.data,
        );
        return stale.data;
      }
      throw err;
    } finally {
      inflightDiscussionComments.delete(cacheKey);
    }
  })();

  inflightDiscussionComments.set(cacheKey, promise);
  return promise;
}

export interface DiscussionThread {
  title: string;
  body: string;
  state: "open" | "closed";
  htmlUrl: string;
  createdAt: string;
  comments: DiscussionComment[];
}

/**
 * Fetch a discussion's title + body + comments in one GraphQL call.
 *
 * Powers the inbox's inline thread viewer. On-demand only (one click) — not polled — so it
 * doesn't add to the GraphQL polling budget, but it still caches with the
 * same TTL as `fetchDiscussionComments` to coalesce repeat opens.
 */
export async function fetchDiscussionThread(
  discussionNumber: number,
): Promise<DiscussionThread | null> {
  const cacheKey = `discussion-thread:${getOwner()}:${getRepo()}:${discussionNumber}`;
  const cached = getCached<DiscussionThread>(cacheKey);
  if (cached) return cached;

  const octokit = getOctokit();
  const query = `
    query DiscussionThread($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        discussion(number: $number) {
          title
          body
          url
          createdAt
          closed
          comments(first: 100) {
            nodes {
              id
              databaseId
              body
              createdAt
              updatedAt
              url
              author { login avatarUrl }
            }
          }
        }
      }
    }
  `;

  const data = await octokit.graphql<{
    repository: {
      discussion: {
        title: string;
        body: string;
        url: string;
        createdAt: string;
        closed: boolean;
        comments: {
          nodes: {
            id: string;
            databaseId: number;
            body: string;
            createdAt: string;
            updatedAt: string;
            url: string;
            author: { login: string; avatarUrl?: string } | null;
          }[];
        };
      } | null;
    };
  }>(query, {
    owner: getOwner(),
    repo: getRepo(),
    number: discussionNumber,
  });

  const d = data.repository.discussion;
  if (!d) return null;

  const thread: DiscussionThread = {
    title: d.title,
    body: d.body ?? "",
    state: d.closed ? "closed" : "open",
    htmlUrl: d.url,
    createdAt: d.createdAt,
    comments: d.comments.nodes.map((n) => ({
      id: n.id,
      databaseId: n.databaseId,
      body: n.body ?? "",
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      url: n.url,
      author: n.author
        ? { login: n.author.login, avatarUrl: n.author.avatarUrl }
        : null,
    })),
  };

  setCache(cacheKey, DISCUSSION_COMMENTS_TTL, thread);
  return thread;
}

/**
 * Post a comment on a discussion. Always uses `userOctokit` so the
 * comment is attributed to the actual user — never the shared polling token.
 */
export async function postDiscussionComment(
  args: { discussionId: string; body: string; discussionNumber?: number },
  userOctokit?: Octokit,
): Promise<DiscussionComment> {
  const octokit = userOctokit ?? getOctokit();
  const data = await octokit.graphql<{
    addDiscussionComment: {
      comment: {
        id: string;
        databaseId: number;
        body: string;
        createdAt: string;
        updatedAt: string;
        url: string;
        author: { login: string; avatarUrl?: string } | null;
      };
    };
  }>(
    `mutation PostDiscussionComment($discussionId: ID!, $body: String!) {
       addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
         comment {
           id
           databaseId
           body
           createdAt
           updatedAt
           url
           author { login avatarUrl }
         }
       }
     }`,
    { discussionId: args.discussionId, body: args.body },
  );
  if (typeof args.discussionNumber === "number") {
    invalidateCache(
      `discussion-comments:${getOwner()}:${getRepo()}:${args.discussionNumber}`,
    );
  } else {
    invalidateDiscussionCache();
  }
  const c = data.addDiscussionComment.comment;
  return {
    id: c.id,
    databaseId: c.databaseId,
    body: c.body ?? "",
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    url: c.url,
    author: c.author
      ? { login: c.author.login, avatarUrl: c.author.avatarUrl }
      : null,
  };
}

// ============ Messaging channels (team chat over Discussions) ============
//
// A messaging "channel" is a GitHub Discussion distinguished by a
// `#`-prefixed title (e.g. `#general`). GitHub
// exposes no API to create discussion *categories*, so we don't try — the
// title prefix cleanly identifies channels in the "General" category.
//
// Reuses the discussion comment ops (`fetchDiscussionComments` /
// `postDiscussionComment`) for thread reads/writes — they're generic
// over a discussion number/id, and posting already invalidates the right
// per-discussion comment cache, so the messaging feed stays fresh without
// extra plumbing.

/** Prefix marking a Discussion as a messaging channel. */
export const MESSAGE_CHANNEL_PREFIX = "#";

export interface MessageChannel {
  /** Numeric discussion number — the channel's stable id in the URL. */
  number: number;
  /** GraphQL node ID, needed to post comments. */
  id: string;
  /** Channel name without the leading `#`. */
  name: string;
  url: string;
  commentsCount: number;
  /** Discussion `updatedAt` — used to sort most-active channels first. */
  updatedAt: string;
  /** Login of whoever opened the channel. */
  author: { login: string; avatarUrl?: string } | null;
}

const MESSAGE_CHANNELS_TTL = 30_000; // 30s — list is UI-polled
const inflightMessageChannels = new Map<string, Promise<MessageChannel[]>>();

/** Normalize a user-supplied channel name into a `#slug` discussion title. */
export function channelTitleFromName(rawName: string): string {
  const slug = slugifyTitle(rawName.replace(/^#+/, ""), {
    maxLength: 48,
    fallback: "channel",
    allowUnderscore: false,
  });
  return `${MESSAGE_CHANNEL_PREFIX}${slug}`;
}

/**
 * List messaging channels: Discussions in the resolved category whose title
 * starts with `#`. Cached + in-flight-deduped + stale-on-error, matching the
 * `fetchOpenPRs` GraphQL rate-limit pattern (no ETag on GraphQL).
 */
export async function fetchMessageChannels(): Promise<MessageChannel[]> {
  const cacheKey = `message-channels:${getOwner()}:${getRepo()}`;
  const cached = getCached<MessageChannel[]>(cacheKey);
  if (cached) return cached;

  const existing = inflightMessageChannels.get(cacheKey);
  if (existing) return existing;

  const stale = getStale<MessageChannel[]>(cacheKey);
  const octokit = getOctokit();

  const query = `
    query MessageChannels($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        discussions(first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) {
          nodes {
            id
            number
            title
            url
            updatedAt
            comments(first: 0) { totalCount }
            author { login avatarUrl }
          }
        }
      }
    }
  `;

  const promise = (async () => {
    try {
      const data = await octokit.graphql<{
        repository: {
          discussions: {
            nodes: {
              id: string;
              number: number;
              title: string;
              url: string;
              updatedAt: string;
              comments: { totalCount: number };
              author: { login: string; avatarUrl?: string } | null;
            }[];
          };
        };
      }>(query, { owner: getOwner(), repo: getRepo() });

      const channels: MessageChannel[] = data.repository.discussions.nodes
        .filter((n) => n.title.startsWith(MESSAGE_CHANNEL_PREFIX))
        .map((n) => ({
          number: n.number,
          id: n.id,
          name: n.title.slice(MESSAGE_CHANNEL_PREFIX.length) || n.title,
          url: n.url,
          commentsCount: n.comments.totalCount,
          updatedAt: n.updatedAt,
          author: n.author
            ? { login: n.author.login, avatarUrl: n.author.avatarUrl }
            : null,
        }));
      setCache(cacheKey, MESSAGE_CHANNELS_TTL, channels);
      return channels;
    } catch (err) {
      if (stale) {
        setCache(cacheKey, Math.min(MESSAGE_CHANNELS_TTL, 30_000), stale.data);
        return stale.data;
      }
      throw err;
    } finally {
      inflightMessageChannels.delete(cacheKey);
    }
  })();

  inflightMessageChannels.set(cacheKey, promise);
  return promise;
}

/**
 * Create a new messaging channel (a `#`-titled Discussion in the preferred
 * category). Attributed to the human via `userOctokit`.
 */
export async function createMessageChannel(
  args: { name: string; categoryId: string; topic?: string },
  userOctokit?: Octokit,
): Promise<MessageChannel> {
  const title = channelTitleFromName(args.name);
  const created = await createDiscussion(
    {
      title,
      body:
        args.topic?.trim() ||
        `Team channel **${title}** — messages here fan out to @mentioned teammates via push, Slack, and the inbox.`,
      categoryId: args.categoryId,
    },
    userOctokit,
  );
  return {
    number: created.number,
    id: created.id,
    name: title.slice(MESSAGE_CHANNEL_PREFIX.length),
    url: created.url,
    commentsCount: created.commentsCount,
    updatedAt: new Date().toISOString(),
    author: null,
  };
}

/**
 * Permanently delete a channel (its backing Discussion). A channel is
 * disposable team chat, so the user can remove it outright. Attributed
 * to the human via `userOctokit` (needs maintain/admin on the repo).
 */
export async function deleteMessageChannel(
  discussionId: string,
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit();
  await octokit.graphql(
    `mutation DeleteMessageChannel($id: ID!) {
       deleteDiscussion(input: { id: $id }) {
         discussion { id }
       }
     }`,
    { id: discussionId },
  );
  invalidateDiscussionCache();
}
