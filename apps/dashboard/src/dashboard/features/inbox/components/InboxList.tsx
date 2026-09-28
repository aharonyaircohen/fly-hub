"use client";
/**
 * @fileType component
 * @domain kody
 * @pattern inbox-list
 * @ai-summary Inbox UI: two sections (Unread / Read) of mention entries
 *   pulled from the user's per-repo gist. Each row shows author + title +
 *   snippet + relative time; click opens the deep URL in a new tab and
 *   marks the entry read. Top toolbar exposes mark-all-read, refresh, and
 *   a one-click jump to settings if the PAT is missing the `gist` scope.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RepoScopedLink } from "@dashboard/lib/components/RepoScopedLink";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  Check,
  CheckCheck,
  ExternalLink,
  FileText,
  Inbox as InboxIcon,
  Loader2,
  MinusCircle,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@kody-ade/base/ui/button";
import { Input } from "@kody-ade/base/ui/input";
import { PageShell } from "@dashboard/lib/components/PageShell";
import { OperatorsWarningBanner } from "@dashboard/features/admin/components/OperatorsWarningBanner";
import {
  InboxThreadDialog,
  resolvableThread,
} from "@dashboard/features/inbox/components/InboxThreadDialog";
import { ConfirmDialog } from "@dashboard/lib/components/ConfirmDialog";
import {
  DecisionButtons,
  InboxCard,
} from "@dashboard/features/inbox/components/InboxCard";
import { kodyApi } from "@dashboard/lib/api";
import {
  SOURCE_CHIP,
  TYPE_LABEL,
  TYPE_ORDER,
  VERDICT_CLASS,
  VERDICT_LABEL,
  type CtoVerdict,
} from "@dashboard/lib/inbox/presentation";
import { useAuth } from "@dashboard/lib/auth-context";
import { useInbox } from "@dashboard/lib/inbox/useInbox";
import { cn } from "@dashboard/lib/utils";
import {
  detectCtoRecommendation,
  type CtoAction,
} from "@dashboard/lib/cto/recommendation";
import { useTrust } from "@dashboard/lib/cto/useTrust";
import { useTrustDecisions } from "@dashboard/lib/cto/useTrustDecisions";
import { useNotificationStore } from "@dashboard/lib/notifications/useNotificationStore";
import { NOTIFICATION_META } from "@dashboard/lib/notifications/types";
import { syncMutedTypes } from "@dashboard/lib/notifications/sync-prefs";
import type { ServerNotificationType } from "@dashboard/lib/notifications/prefs-store";
import type { InboxEntry, InboxSource } from "@dashboard/lib/inbox/types";
import { repoScopedHref } from "@kody-ade/base/routes";
import {
  INBOX_THREAD_PARAM,
  buildSyntheticInboxEntry,
  buildThreadShareLink,
  parseThreadParam,
  serializeThreadParam,
  type DeepLinkType,
} from "@dashboard/lib/inbox/deep-link";

/** Case-insensitive substring match across an entry's searchable fields. */
function matchesQuery(entry: InboxEntry, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return [
    entry.title,
    entry.snippet,
    entry.author,
    entry.repoFullName,
    entry.threadType,
    entry.source,
  ].some((field) => field?.toLowerCase().includes(needle));
}

/** Coarse "when" bucket for the date headers, computed from local midnight. */
function dateBucket(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "Older";
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const day = 86_400_000;
  if (t >= startOfToday) return "Today";
  if (t >= startOfToday - day) return "Yesterday";
  if (t >= startOfToday - 6 * day) return "Earlier this week";
  return "Older";
}
const BUCKET_ORDER = ["Today", "Yesterday", "Earlier this week", "Older"];

/**
 * Split a (newest-first) entry list into date buckets, preserving order within
 * each bucket and dropping empty ones.
 */
function groupByDate(
  entries: InboxEntry[],
): { label: string; entries: InboxEntry[] }[] {
  const map = new Map<string, InboxEntry[]>();
  for (const e of entries) {
    const b = dateBucket(e.sentAt);
    const arr = map.get(b);
    if (arr) arr.push(e);
    else map.set(b, [e]);
  }
  return BUCKET_ORDER.filter((b) => map.has(b)).map((label) => ({
    label,
    entries: map.get(label)!,
  }));
}

type SourceFilter = InboxSource | "all";

/**
 * Combined predicate for the inbox list: search query AND each active filter
 * must pass. `ctoOnly` keeps only CTO recommendation entries (detected the
 * same way the row renders them, so legacy recs without `ctoAction` count).
 */
function matchesFilters(
  entry: InboxEntry,
  q: string,
  source: SourceFilter,
  type: string,
  ctoOnly: boolean,
): boolean {
  if (!matchesQuery(entry, q)) return false;
  if (source !== "all" && entry.source !== source) return false;
  if (type !== "all" && entry.threadType !== type) return false;
  if (ctoOnly && !detectCtoRecommendation(entry)) return false;
  return true;
}

/** Pill-style toggle used across the inbox filter bar. */
function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    // eslint-disable-next-line react/forbid-elements -- stateful pill chip; Button base font/hover styles would visibly change it
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs transition",
        active
          ? "border-amber-400/40 bg-amber-400/10 text-amber-100"
          : "border-white/10 bg-white/[0.02] text-white/50 hover:border-white/20 hover:text-white/80",
      )}
    >
      {children}
    </button>
  );
}

export function InboxList() {
  const { auth } = useAuth();
  const scopedHref = (href: string) =>
    auth ? repoScopedHref(auth, href) : href;
  const {
    unread,
    read,
    isLoading,
    isFetching,
    error,
    refetch,
    markRead,
    markUnread,
    markAllRead,
    clearAll,
    remove,
  } = useInbox();
  const { verdictFor, invalidate: refreshDecisions } = useTrustDecisions();
  const trust = useTrust();
  const [deciding, setDeciding] = useState(false);

  /** Decide a capability REQUEST right here (no report exists for it):
   *  approve posts its `@kody <capability>` command; all verdicts feed trust. */
  const decideRequest = async (
    rec: NonNullable<ReturnType<typeof detectCtoRecommendation>>,
    decision: CtoVerdict,
  ) => {
    setDeciding(true);
    try {
      await kodyApi.cto.decide({
        taskNumber: rec.taskNumber,
        action: rec.action,
        agent: rec.agent,
        capability: rec.capability,
        decision,
        ...(rec.command ? { command: rec.command } : {}),
        ...(rec.repo ? { repoFullName: rec.repo } : {}),
        ...(auth?.user?.login ? { actorLogin: auth.user.login } : {}),
      });
      refreshDecisions();
      toast.success(
        decision === "approve"
          ? rec.action === "merge"
            ? `Approved — merged PR #${rec.taskNumber}`
            : `Approved — posted ${rec.command ?? "the request"} on #${rec.taskNumber}`
          : decision === "reject"
            ? "Rejected"
            : "Dismissed",
      );
    } catch (err) {
      toast.error("Decision failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setDeciding(false);
    }
  };
  const decidePipeline = async (entry: InboxEntry, decision: CtoVerdict) => {
    const approval = entry.pipelineApproval;
    if (!approval || decision === "dismiss") return;
    setDeciding(true);
    try {
      const status = await kodyApi.company.decidePipeline({
        pipelineId: approval.pipelineId,
        runId: approval.runId,
        decision,
      });
      toast.success(
        status === "approved"
          ? "Approved — Pipeline resumed"
          : "Rejected — Pipeline stopped",
      );
      await remove(entry.id);
    } catch (err) {
      toast.error("Decision failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setDeciding(false);
    }
  };
  const { prefs: notifPrefs, updatePrefs: updateNotifPrefs } =
    useNotificationStore();
  // Latest muted list, kept in a ref so the toast "Undo" callback (created at
  // mute time) always reads the current state instead of a stale closure.
  const mutedRef = useRef(notifPrefs.disabledTypes);
  useEffect(() => {
    mutedRef.current = notifPrefs.disabledTypes;
  }, [notifPrefs.disabledTypes]);

  const setCategoryMuted = (
    category: ServerNotificationType,
    shouldMute: boolean,
  ) => {
    const current = mutedRef.current;
    const has = current.includes(category);
    if (has === shouldMute) return; // already in the desired state
    const next = shouldMute
      ? [...current, category]
      : current.filter((t) => t !== category);
    mutedRef.current = next;
    updateNotifPrefs({ disabledTypes: next }); // local cache + UI
    syncMutedTypes(next); // server prefs → webhook spine drops future entries
    const label = NOTIFICATION_META[category].label;
    if (shouldMute) {
      toast.success(`Muted “${label}” notifications`, {
        description:
          "These won't land in your inbox. Manage anytime in Notification Settings.",
        action: {
          label: "Undo",
          onClick: () => setCategoryMuted(category, false),
        },
      });
    } else {
      toast(`Unmuted “${label}” notifications`);
    }
  };
  const toggleCategoryMute = (category: ServerNotificationType) =>
    setCategoryMuted(category, !mutedRef.current.includes(category));

  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeEntry, setActiveEntry] = useState<InboxEntry | null>(null);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [ctoOnly, setCtoOnly] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const totalCount = unread.length + read.length;

  const handleClearAll = async () => {
    try {
      await clearAll();
      toast.success("Inbox cleared");
    } catch (err) {
      toast.error("Clear inbox failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };
  const connectedRepo = auth ? `${auth.owner}/${auth.repo}` : undefined;

  const trimmedQuery = query.trim();
  const filtersActive =
    sourceFilter !== "all" || typeFilter !== "all" || ctoOnly;
  const filteredUnread = useMemo(
    () =>
      unread.filter((e) =>
        matchesFilters(e, trimmedQuery, sourceFilter, typeFilter, ctoOnly),
      ),
    [unread, trimmedQuery, sourceFilter, typeFilter, ctoOnly],
  );
  const filteredRead = useMemo(
    () =>
      read.filter((e) =>
        matchesFilters(e, trimmedQuery, sourceFilter, typeFilter, ctoOnly),
      ),
    [read, trimmedQuery, sourceFilter, typeFilter, ctoOnly],
  );

  // Build the chip options from what's actually in the inbox so we never show
  // a filter that would match nothing. Derived from the unfiltered union so
  // chips stay stable while a filter is active.
  const allEntries = useMemo(() => [...unread, ...read], [unread, read]);
  const availableTypes = useMemo(() => {
    const set = new Set<string>();
    for (const e of allEntries) if (e.threadType) set.add(e.threadType);
    return [...set].sort((a, b) => {
      const ia = TYPE_ORDER.indexOf(a);
      const ib = TYPE_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [allEntries]);
  const availableSources = useMemo(() => {
    const set = new Set<InboxSource>();
    for (const e of allEntries) set.add(e.source);
    return [...set];
  }, [allEntries]);
  const hasCto = useMemo(
    () => allEntries.some((e) => detectCtoRecommendation(e)),
    [allEntries],
  );
  const showFilterBar =
    availableTypes.length > 1 || availableSources.length > 1 || hasCto;

  const clearFilters = () => {
    setSourceFilter("all");
    setTypeFilter("all");
    setCtoOnly(false);
  };

  // Shareable deep link: `/inbox?thread=<Type>:<number>` opens the thread
  // panel for that issue/PR/discussion in the *viewer's* connected repo.
  // The link targets the thread, not a gist entry (the inbox is private
  // per-user), so a synthetic entry is enough to drive the dialog.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const deepLink = useMemo(
    () => parseThreadParam(searchParams.get(INBOX_THREAD_PARAM)),
    [searchParams],
  );
  // The deep-link value we've already acted on. Without this, closing the
  // dialog (`setActiveEntry(null)`) re-runs the auto-open effect before
  // `useSearchParams()` reflects the cleared param, so `deepLink` is still
  // set and the dialog jumps back open. Tracking the consumed value makes
  // auto-open fire only for a genuinely new link, never a re-close.
  const consumedDeepLinkRef = useRef<string | null>(null);
  const clearDeepLink = () => {
    if (!searchParams.has(INBOX_THREAD_PARAM)) return;
    const next = new URLSearchParams(searchParams);
    next.delete(INBOX_THREAD_PARAM);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  // Reflect the opened thread in the URL so the address bar is the
  // shareable link and Back/refresh restore the open item.
  const syncDeepLink = (type: DeepLinkType, number: number) => {
    const value = serializeThreadParam(type, number);
    // Manually opened — mark consumed so the effect's param lag can't
    // reopen this same thread after the user closes it.
    consumedDeepLinkRef.current = value;
    if (searchParams.get(INBOX_THREAD_PARAM) === value) return;
    const next = new URLSearchParams(searchParams);
    next.set(INBOX_THREAD_PARAM, value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  useEffect(() => {
    if (!deepLink || !connectedRepo || activeEntry) return;
    const key = serializeThreadParam(deepLink.type, deepLink.number);
    if (consumedDeepLinkRef.current === key) return;
    consumedDeepLinkRef.current = key;
    setActiveEntry(
      buildSyntheticInboxEntry(connectedRepo, deepLink.type, deepLink.number),
    );
  }, [deepLink, connectedRepo, activeEntry]);

  const scopeMissing = /gist_scope_missing|gist.*scope/i.test(
    error?.message ?? "",
  );

  const subtitle = auth ? `${auth.owner}/${auth.repo}` : undefined;

  const openEntry = async (entry: InboxEntry) => {
    // Issues/PRs in the connected repo render inline. Everything else
    // (discussions, commits, cross-repo) has no inline view — clicking only
    // marks it read; GitHub stays behind the explicit external-link icon.
    const target = resolvableThread(entry, connectedRepo);
    if (target) {
      setActiveEntry(entry);
      syncDeepLink(target.type, target.number);
    } else if (entry.source === "kody") {
      try {
        const url = new URL(entry.url, window.location.origin);
        if (url.origin === window.location.origin) {
          router.push(`${url.pathname}${url.search}${url.hash}`);
        } else {
          window.open(url.toString(), "_blank", "noopener,noreferrer");
        }
      } catch {
        return;
      }
    }
    if (entry.readAt === null) {
      setBusyId(entry.id);
      try {
        await markRead(entry.id);
      } finally {
        setBusyId(null);
      }
    }
  };

  return (
    <PageShell
      title="Inbox"
      icon={InboxIcon}
      iconClassName="text-amber-300"
      subtitle={subtitle}
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="gap-1"
            aria-label="Refresh inbox"
          >
            {isFetching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void markAllRead()}
            disabled={unread.length === 0}
            className="gap-1"
          >
            <CheckCheck className="w-4 h-4" />
            Mark all read
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmClear(true)}
            disabled={totalCount === 0}
            className="gap-1 text-rose-300 hover:text-rose-200"
          >
            <Trash2 className="w-4 h-4" />
            Clear inbox
          </Button>
        </>
      }
    >
      <OperatorsWarningBanner />

      {scopeMissing && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 text-amber-300 shrink-0" />
            <div>
              <p className="font-medium text-amber-200">
                PAT missing the `gist` scope
              </p>
              <p className="text-xs text-amber-100/70 mt-1">
                The inbox lives in a private gist owned by you. Re-connect this
                repo with a PAT that includes the `gist` scope from the repo
                menu in the header (the ▾ next to the repo name → Add
                repository).
              </p>
            </div>
          </div>
        </div>
      )}

      {error && !scopeMissing && (
        <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/[0.06] p-3 text-xs text-rose-200">
          {error.message}
        </div>
      )}

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search inbox — title, author, repo, type…"
          className="pl-9"
          aria-label="Search inbox"
        />
      </div>

      {showFilterBar && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {availableTypes.length > 1 && (
            <>
              <span className="mr-0.5 text-[10px] uppercase tracking-wide text-white/30">
                Type
              </span>
              <FilterChip
                active={typeFilter === "all"}
                onClick={() => setTypeFilter("all")}
              >
                All
              </FilterChip>
              {availableTypes.map((t) => (
                <FilterChip
                  key={t}
                  active={typeFilter === t}
                  onClick={() => setTypeFilter(typeFilter === t ? "all" : t)}
                >
                  {TYPE_LABEL[t] ?? t}
                </FilterChip>
              ))}
            </>
          )}

          {availableSources.length > 1 && (
            <>
              <span className="ml-1 mr-0.5 text-[10px] uppercase tracking-wide text-white/30">
                Source
              </span>
              <FilterChip
                active={sourceFilter === "all"}
                onClick={() => setSourceFilter("all")}
              >
                All
              </FilterChip>
              {availableSources.map((s) => (
                <FilterChip
                  key={s}
                  active={sourceFilter === s}
                  onClick={() =>
                    setSourceFilter(sourceFilter === s ? "all" : s)
                  }
                >
                  {SOURCE_CHIP[s]}
                </FilterChip>
              ))}
            </>
          )}

          {hasCto && (
            <FilterChip active={ctoOnly} onClick={() => setCtoOnly((v) => !v)}>
              Recommendations
            </FilterChip>
          )}

          {filtersActive && (
            // eslint-disable-next-line react/forbid-elements -- bare text link with no hover surface; Button ghost hover bg would visibly change it
            <button
              type="button"
              onClick={clearFilters}
              className="ml-1 inline-flex items-center gap-1 text-xs text-white/40 hover:text-white/70"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>
      )}

      <Section
        title={`Unread (${filteredUnread.length})`}
        empty={
          isLoading
            ? "Loading…"
            : trimmedQuery || filtersActive
              ? "No unread matches your filters."
              : "Nothing unread. New @mentions land here automatically."
        }
        entries={filteredUnread}
        connectedRepo={connectedRepo}
        busyId={busyId}
        onOpen={openEntry}
        onToggleRead={(id) => void markRead(id)}
        onDelete={(id) => void remove(id)}
        isMuted={(c) => notifPrefs.disabledTypes.includes(c)}
        onToggleMute={toggleCategoryMute}
        verdictFor={verdictFor}
        repoHref={scopedHref}
        readSection={false}
        onDecideRequest={(rec, decision) => void decideRequest(rec, decision)}
        onDecidePipeline={(entry, decision) =>
          void decidePipeline(entry, decision)
        }
        deciding={deciding}
        trustStreakFor={(capability) =>
          trust.capabilities[capability]?.consecutiveApprovals ?? null
        }
      />

      {filteredRead.length > 0 && (
        <div className="mt-6">
          <Section
            title={`Read (${filteredRead.length})`}
            empty=""
            entries={filteredRead}
            connectedRepo={connectedRepo}
            busyId={busyId}
            onOpen={openEntry}
            onToggleRead={(id) => void markUnread(id)}
            onDelete={(id) => void remove(id)}
            isMuted={(c) => notifPrefs.disabledTypes.includes(c)}
            onToggleMute={toggleCategoryMute}
            verdictFor={verdictFor}
            repoHref={scopedHref}
            readSection
            onDecideRequest={(rec, decision) =>
              void decideRequest(rec, decision)
            }
            onDecidePipeline={(entry, decision) =>
              void decidePipeline(entry, decision)
            }
            deciding={deciding}
            trustStreakFor={(capability) =>
              trust.capabilities[capability]?.consecutiveApprovals ?? null
            }
          />
        </div>
      )}

      <p className="mt-8 text-[10px] text-white/30 flex items-center gap-1">
        <ExternalLink className="w-3 h-3" />
        Entries are stored in a private gist on your GitHub account. Switching
        repos swaps the inbox automatically.
      </p>

      <InboxThreadDialog
        entry={activeEntry}
        onClose={() => {
          setActiveEntry(null);
          clearDeepLink();
        }}
        footer={(() => {
          if (!activeEntry) return undefined;
          const rec = detectCtoRecommendation(activeEntry);
          if (!rec && !activeEntry.pipelineApproval) return undefined;
          return (
            <CtoDialogActions
              action={rec?.action ?? "continue pipeline"}
              label={activeEntry.pipelineApproval ? "Kody" : "CTO"}
              allowDismiss={!activeEntry.pipelineApproval}
              verdict={
                rec
                  ? verdictFor(
                      rec.capability,
                      rec.taskNumber,
                      rec.action,
                      activeEntry.sentAt,
                    )
                  : null
              }
              {...(activeEntry.source === "request"
                ? {
                    onDecide: (decision: CtoVerdict) =>
                      activeEntry.pipelineApproval
                        ? void decidePipeline(activeEntry, decision)
                        : rec
                          ? void decideRequest(rec, decision)
                          : undefined,
                    deciding,
                  }
                : {})}
            />
          );
        })()}
      />
      <ConfirmDialog
        open={confirmClear}
        title="Clear entire inbox?"
        description={`This permanently removes all ${totalCount} ${
          totalCount === 1 ? "entry" : "entries"
        } (read and unread). This can't be undone.`}
        confirmLabel="Clear inbox"
        variant="destructive"
        onConfirm={() => void handleClearAll()}
        onClose={() => setConfirmClear(false)}
      />
    </PageShell>
  );
}

/**
 * Recommendation footer for opened inbox threads. Report-backed decisions
 * live on /reports; Inbox keeps the notification and links the operator
 * there. Capability REQUESTS have no report — they are decided right here:
 * Approve posts the request's `@kody <capability>` command on the issue and
 * records the trust decision; Reject/Dismiss record only.
 */
function CtoDialogActions({
  action,
  verdict,
  onDecide,
  deciding,
  allowDismiss = true,
  label = "CTO",
}: {
  action: string;
  verdict: CtoVerdict | null;
  /** Present only for directly-decidable entries (capability requests). */
  onDecide?: (decision: CtoVerdict) => void;
  deciding?: boolean;
  allowDismiss?: boolean;
  label?: string;
}) {
  if (onDecide && !verdict) {
    return (
      <>
        <span className="mr-auto text-[10px] uppercase tracking-wider text-amber-300/70">
          {label} · {action}
        </span>
        <DecisionButtons
          deciding={!!deciding}
          onDecide={onDecide}
          allowDismiss={allowDismiss}
        />
      </>
    );
  }
  return (
    <>
      <span className="mr-auto text-[10px] uppercase tracking-wider text-amber-300/70">
        {label} · {action === "other" ? "review" : action}
      </span>
      {verdict ? (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium",
            VERDICT_CLASS[verdict],
          )}
          title="This recommendation was already decided"
        >
          {verdict === "approve" ? (
            <Check className="w-3.5 h-3.5" />
          ) : verdict === "reject" ? (
            <X className="w-3.5 h-3.5" />
          ) : (
            <MinusCircle className="w-3.5 h-3.5" />
          )}
          {VERDICT_LABEL[verdict]}
        </span>
      ) : (
        <Button
          asChild
          size="sm"
          variant="ghost"
          className="h-7 gap-1 border border-amber-500/30 bg-amber-500/[0.06] text-amber-200 hover:bg-amber-500/15"
        >
          <RepoScopedLink href="/reports">
            <FileText className="w-3.5 h-3.5" />
            Review reports
          </RepoScopedLink>
        </Button>
      )}
    </>
  );
}

interface SectionProps {
  title: string;
  empty: string;
  entries: InboxEntry[];
  connectedRepo: string | undefined;
  busyId: string | null;
  onOpen: (entry: InboxEntry) => void;
  onToggleRead: (id: string) => void;
  onDelete: (id: string) => void;
  isMuted: (category: ServerNotificationType) => boolean;
  onToggleMute: (category: ServerNotificationType) => void;
  verdictFor: (
    capability: string,
    taskNumber: number,
    action: CtoAction,
    sinceIso?: string,
  ) => CtoVerdict | null;
  repoHref: (href: string) => string;
  readSection: boolean;
  onDecideRequest: (
    rec: NonNullable<ReturnType<typeof detectCtoRecommendation>>,
    decision: CtoVerdict,
  ) => void;
  onDecidePipeline: (entry: InboxEntry, decision: CtoVerdict) => void;
  deciding: boolean;
  /** Clean-approval streak for a capability, or null when unknown. */
  trustStreakFor: (capability: string) => number | null;
}

function Section({
  title,
  empty,
  entries,
  connectedRepo,
  busyId,
  onOpen,
  onToggleRead,
  onDelete,
  isMuted,
  onToggleMute,
  verdictFor,
  repoHref,
  readSection,
  onDecideRequest,
  onDecidePipeline,
  deciding,
  trustStreakFor,
}: SectionProps) {
  const copyLinkFor = (entry: InboxEntry) => async (): Promise<boolean> => {
    if (typeof window === "undefined") return false;
    const target = resolvableThread(entry, connectedRepo);
    const link = target
      ? buildThreadShareLink(window.location.origin, target.type, target.number)
      : entry.url;
    try {
      await navigator.clipboard.writeText(link);
      return true;
    } catch {
      window.prompt("Copy this link", link);
      return false;
    }
  };

  return (
    <div>
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-white/40 mb-2">
        {title}
      </h2>
      {entries.length === 0 ? (
        empty ? (
          <p className="text-xs text-white/40 italic">{empty}</p>
        ) : null
      ) : (
        <div className={cn("space-y-4", readSection && "opacity-80")}>
          {groupByDate(entries).map((group) => (
            <div key={group.label}>
              <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-white/30">
                {group.label}
              </h3>
              <ul className="space-y-2">
                {group.entries.map((e) => {
                  const rec = detectCtoRecommendation(e);
                  const verdict = rec
                    ? verdictFor(
                        rec.capability,
                        rec.taskNumber,
                        rec.action,
                        e.sentAt,
                      )
                    : null;
                  return (
                    <InboxCard
                      key={e.id}
                      entry={e}
                      rec={rec}
                      verdict={verdict}
                      inlineThreadNumber={
                        resolvableThread(e, connectedRepo)?.number ?? null
                      }
                      trustStreak={rec ? trustStreakFor(rec.capability) : null}
                      deciding={deciding}
                      busy={busyId === e.id}
                      onOpen={() => onOpen(e)}
                      onToggleRead={() => onToggleRead(e.id)}
                      onDelete={() => onDelete(e.id)}
                      onDecide={(decision) =>
                        e.pipelineApproval
                          ? onDecidePipeline(e, decision)
                          : rec
                            ? onDecideRequest(rec, decision)
                            : undefined
                      }
                      onCopyLink={copyLinkFor(e)}
                      isMuted={isMuted}
                      onToggleMute={onToggleMute}
                      repoHref={repoHref}
                    />
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      {busyId && (
        <span className="sr-only" role="status">
          Updating {busyId}…
        </span>
      )}
    </div>
  );
}
