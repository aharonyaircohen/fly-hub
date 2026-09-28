/**
 * @fileType utility
 * @domain kody
 * @pattern operator-request-inbox-dispatch
 * @ai-summary Server-only helper that turns an agent-authored capability
 *   request issue into an inbox entry for every operator — so requests like
 *   "[operation-creator] Propose X" stop sitting unnoticed as plain issues.
 *
 *   Convention: an agent that needs a human-approved capability run opens an
 *   issue titled `[<capability-slug>] <summary>`. On the `issues` webhook we
 *   append one inbox-feed entry per operator carrying `source: "request"`,
 *   `ctoAction: "request"`, and the `@kody <slug>` command — so the existing
 *   inbox Approve/Reject flow (and the per-capability trust ledger) applies
 *   unchanged: Approve posts the command on the issue, the engine runs the
 *   capability there.
 *
 *   Idempotent: deterministic ids (`operator-request:<login>:<repo>#<n>`) and
 *   `appendInboxFeed` dedupes by id. Never throws — logs and swallows so a
 *   feed-write failure can't break webhook delivery.
 */
import "server-only";
import { createUserOctokit } from "../github-client";
import { readOperators } from "@kody-ade/base/engine/config";
import { resolveBackgroundToken } from "@kody-ade/base/auth/background-token";
import { appendInboxFeed } from "../inbox/feed-server";
import type { InboxFeedEntry } from "../inbox/feed";
import { logger } from "@kody-ade/base/logger";

/** `[operation-creator] Propose …` → "operation-creator". */
const REQUEST_TITLE_RE = /^\[([a-z0-9][a-z0-9-]{0,39})\]\s+\S/;

const SNIPPET_MAX = 240;

export interface OperatorRequestIssue {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  author: string | undefined;
  url: string;
  openedAt: string;
}

/** Parse the capability slug from a request-convention title, or null. */
export function requestCapabilitySlug(title: string): string | null {
  const match = REQUEST_TITLE_RE.exec(title.trim());
  return match?.[1] ?? null;
}

/** Extract the issue fields we need, or null when this event is not an
 *  agent capability request being opened/reopened. Exported for unit tests. */
export function requestIssueFromPayload(
  eventType: string,
  payload: Record<string, unknown>,
): OperatorRequestIssue | null {
  if (eventType !== "issues") return null;
  if (payload.action !== "opened" && payload.action !== "reopened") return null;

  const issue = payload.issue as Record<string, unknown> | undefined;
  const repository = payload.repository as Record<string, unknown> | undefined;
  const fullName =
    typeof repository?.full_name === "string" ? repository.full_name : "";
  const [owner, repo] = fullName.split("/");
  const number = typeof issue?.number === "number" ? issue.number : null;
  const title = typeof issue?.title === "string" ? issue.title : "";
  const url = typeof issue?.html_url === "string" ? issue.html_url : "";
  if (!owner || !repo || !number || !url) return null;
  if (!requestCapabilitySlug(title)) return null;

  const user = issue?.user as Record<string, unknown> | undefined;
  return {
    owner,
    repo,
    number,
    title,
    body: typeof issue?.body === "string" ? issue.body : "",
    author: typeof user?.login === "string" ? user.login : undefined,
    url,
    // Delivery time, not the issue's created_at: the inbox watcher pulls
    // entries newer than its cursor, and a reopened request must surface now.
    openedAt: new Date().toISOString(),
  };
}

/** First body lines as a plain-text preview, markdown headings stripped. */
function snippetFromBody(body: string): string {
  return body
    .replace(/^#+\s*/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SNIPPET_MAX);
}

/** One inbox-feed entry per operator. Exported for unit tests. */
export function buildRequestEntries(
  issue: OperatorRequestIssue,
  operators: string[],
): InboxFeedEntry[] {
  const capability = requestCapabilitySlug(issue.title);
  if (!capability) return [];
  const repoFullName = `${issue.owner}/${issue.repo}`;
  const snippet = snippetFromBody(issue.body);
  return operators.map((login) => ({
    id: `operator-request:${login}:${repoFullName}#${issue.number}`,
    login,
    source: "request",
    repoFullName,
    threadType: "Issue",
    title: issue.title,
    snippet,
    author: issue.author,
    url: issue.url,
    sentAt: issue.openedAt,
    ctoAction: "request",
    ctoCommand: `@kody ${capability}`,
    ctoCapability: capability,
  }));
}

/**
 * Entry point — call from the webhook receiver on every event. Cheap noop for
 * anything that isn't a request-convention issue being opened. Never throws.
 */
export async function dispatchOperatorRequests(
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const issue = requestIssueFromPayload(eventType, payload);
    if (!issue) return;
    const repoFullName = `${issue.owner}/${issue.repo}`;

    const bg = await resolveBackgroundToken(issue.owner, issue.repo);
    if (!bg) {
      logger.warn(
        { event: "operator_request_no_token", repo: repoFullName },
        "Operator request seen but no background token — cannot write inbox feed",
      );
      return;
    }

    const operators = await readOperators(
      createUserOctokit(bg.token),
      issue.owner,
      issue.repo,
    );
    if (operators.length === 0) {
      logger.info(
        { event: "operator_request_no_operators", repo: repoFullName },
        "Operator request seen but no operators configured — nothing to route",
      );
      return;
    }

    const added = await appendInboxFeed(buildRequestEntries(issue, operators));
    logger.info(
      {
        event: "operator_request_inbox_appended",
        added,
        issue: issue.number,
        operators: operators.length,
        repo: repoFullName,
      },
      `Operator-request inbox: +${added} entr${added === 1 ? "y" : "ies"}`,
    );
  } catch (err) {
    logger.error(
      {
        event: "operator_request_dispatch_crashed",
        error: err instanceof Error ? err.message : String(err),
      },
      "dispatchOperatorRequests threw — swallowing so webhook still ACKs",
    );
  }
}
