/**
 * @fileType utility
 * @domain kody
 * @pattern inbox-presentation
 * @ai-summary Pure display helpers shared by the inbox list and its cards:
 *   source/type labels, verdict badge styling, relative time, the
 *   notification-category mapper behind "Mute this type", and title
 *   cleanup for agent requests. No React, no side effects.
 */
import type { ServerNotificationType } from "../notifications/prefs-store";
import type { InboxEntry, InboxSource } from "./types";

export type CtoVerdict = "approve" | "reject" | "dismiss";

/** Verb labels for the per-row subline. */
export const SOURCE_LABEL: Record<InboxSource, string> = {
  mention: "mentioned you",
  team_mention: "mentioned your team",
  review_requested: "requested your review",
  assigned: "assigned you",
  comment: "commented",
  subscribed: "subscribed thread",
  request: "requests your approval",
  kody: "needs your attention",
  other: "activity",
};

/** Short noun labels for the source filter chips (vs SOURCE_LABEL's verbs). */
export const SOURCE_CHIP: Record<InboxSource, string> = {
  mention: "Mentions",
  team_mention: "Team mentions",
  review_requested: "Review requests",
  assigned: "Assigned",
  comment: "Comments",
  subscribed: "Subscribed",
  request: "Requests",
  kody: "Kody",
  other: "Other",
};

/** Human labels for the GitHub thread types we surface in the inbox. */
export const TYPE_LABEL: Record<string, string> = {
  Issue: "Issues",
  PullRequest: "PRs",
  Discussion: "Discussions",
  Commit: "Commits",
  Release: "Releases",
  Workflow: "Workflows",
};

/** Singular labels for the per-row subline (vs TYPE_LABEL's plurals). */
export const TYPE_SINGULAR: Record<string, string> = {
  Issue: "Issue",
  PullRequest: "PR",
  Discussion: "Discussion",
  Commit: "Commit",
  Release: "Release",
  Workflow: "Workflow",
};

/** Stable display order for the type chips; unknown types fall to the end. */
export const TYPE_ORDER = [
  "Issue",
  "PullRequest",
  "Discussion",
  "Commit",
  "Release",
  "Workflow",
];

/**
 * Visual style + label for a settled verdict badge. `dismiss` is the neutral
 * "drain the queue" verdict — distinct grey palette so the operator can tell
 * at a glance it didn't approve or reject.
 */
export const VERDICT_LABEL: Record<CtoVerdict, string> = {
  approve: "Approved",
  reject: "Rejected",
  dismiss: "Dismissed",
};
export const VERDICT_CLASS: Record<CtoVerdict, string> = {
  approve: "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200",
  reject: "border-rose-500/30 bg-rose-500/[0.06] text-rose-200",
  dismiss: "border-white/15 bg-white/[0.05] text-white/70",
};

/** Compact relative timestamp ("5m", "3h", "2d", else a short date). */
export function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Exact local date and time for an inbox entry. */
export function fullTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Agent-request title minus the machine prefix (`[slug] …` / `slug: …`). */
export function questionFromTitle(title: string): string {
  return title
    .replace(/^\[[a-z0-9-]+\]\s*/i, "")
    .replace(/^[a-z0-9-]+:\s*/i, "")
    .trim();
}

/**
 * Notification category this entry can be muted under. New entries carry it
 * stamped at write time; for older entries (written before the field existed)
 * we infer it so the card's "Mute this type" still works:
 *   - a comment/review deep-link (url has a `#…comment`/`#…review` anchor) is
 *     the dominant inbox case → `chat-response`
 *   - a bare thread link maps by thread type (issue opened → `task-assigned`,
 *     PR opened → `pr-ready`, discussion → `chat-response`)
 * Returns null when nothing sensible maps (no mute button shown).
 */
export function inboxCategory(entry: InboxEntry): ServerNotificationType | null {
  if (entry.category) return entry.category;
  const url = entry.url ?? "";
  if (
    /#(issuecomment|discussioncomment|pullrequestreview|discussion_r)/i.test(
      url,
    )
  )
    return "chat-response";
  switch (entry.threadType) {
    case "Issue":
      return "task-assigned";
    case "PullRequest":
      return "pr-ready";
    case "Discussion":
      return "chat-response";
    default:
      return null;
  }
}
