"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, XCircle } from "lucide-react";
import { Button } from "@kody-ade/base/ui/button";
import { Card } from "@kody-ade/base/ui/card";
import { useWorkflowEventDeliveries } from "../hooks/useWorkflowEventDeliveries";
import type {
  WorkflowEventDelivery,
  WorkflowEventDeliveryStatus,
} from "../api/activity";
import { RepoScopedLink } from "./RepoScopedLink";
import { cn } from "../utils";

type EventFilter = "all" | WorkflowEventDeliveryStatus;

function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function eventLabel(eventName: string): string {
  if (eventName === "github.workflow_run.completed") {
    return "GitHub workflow completed";
  }
  return eventName.replaceAll(".", " · ");
}

function statusRank(status: WorkflowEventDeliveryStatus): number {
  return status === "failed" ? 0 : status === "pending" ? 1 : 2;
}

function StatusIcon({ status }: { status: WorkflowEventDeliveryStatus }) {
  if (status === "failed") {
    return <XCircle className="h-4 w-4 text-rose-300" aria-hidden="true" />;
  }
  if (status === "pending") {
    return (
      <Loader2
        className="h-4 w-4 animate-spin text-amber-300"
        aria-hidden="true"
      />
    );
  }
  return (
    <CheckCircle2 className="h-4 w-4 text-emerald-300" aria-hidden="true" />
  );
}

function statusLabel(status: WorkflowEventDeliveryStatus): string {
  return status === "failed"
    ? "Dispatch failed"
    : status === "pending"
      ? "Dispatching"
      : "Dispatched";
}

function sortedEvents(
  events: WorkflowEventDelivery[],
): WorkflowEventDelivery[] {
  return [...events].sort((a, b) => {
    const rank = statusRank(a.status) - statusRank(b.status);
    if (rank !== 0) return rank;
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}

function EventRow({ event }: { event: WorkflowEventDelivery }) {
  return (
    <li className="flex items-start gap-3 border-b border-white/[0.06] px-3 py-3 last:border-b-0">
      <span className="mt-0.5 shrink-0" title={statusLabel(event.status)}>
        <StatusIcon status={event.status} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="truncate font-medium">{event.workflowId}</span>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium",
              event.status === "failed"
                ? "bg-rose-500/15 text-rose-200"
                : event.status === "pending"
                  ? "bg-amber-500/15 text-amber-200"
                  : "bg-emerald-500/15 text-emerald-200",
            )}
          >
            {statusLabel(event.status)}
          </span>
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">
          {eventLabel(event.eventName)} · {event.attempts} dispatch attempt
          {event.attempts === 1 ? "" : "s"} · trigger {event.triggerId}
        </div>
        {event.error ? (
          <div
            className="mt-1 truncate text-xs text-rose-200/80"
            title={event.error}
          >
            {event.error}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        <span>{relativeTime(event.updatedAt)}</span>
        {event.sourceUrl ? (
          <a
            href={event.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open source GitHub workflow run"
            className="rounded p-1 hover:bg-white/[0.06] hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </li>
  );
}

function EventRows({
  events,
  emptyMessage,
}: {
  events: WorkflowEventDelivery[];
  emptyMessage: string;
}) {
  if (events.length === 0) {
    return (
      <p className="px-3 py-4 text-sm text-muted-foreground">{emptyMessage}</p>
    );
  }
  return (
    <ul className="divide-y divide-white/[0.04]">
      {events.map((event) => (
        <EventRow
          key={`${event.sourceEventId ?? event.deliveryId}:${event.triggerId}`}
          event={event}
        />
      ))}
    </ul>
  );
}

export function WorkflowEventsOverview() {
  const { data, isLoading, error } = useWorkflowEventDeliveries(10);
  const events = useMemo(
    () => sortedEvents(data?.events ?? []).slice(0, 5),
    [data],
  );
  const failedCount = (data?.events ?? []).filter(
    (event) => event.status === "failed",
  ).length;

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-label font-semibold uppercase tracking-wider text-muted-foreground/80">
          Workflow deliveries
        </h2>
        <RepoScopedLink
          href="/activity"
          className="inline-flex items-center gap-1 text-body-xs text-muted-foreground hover:text-foreground"
        >
          Activity <span aria-hidden="true">→</span>
        </RepoScopedLink>
      </div>
      <Card>
        {error ? (
          <p className="px-3 py-4 text-sm text-rose-200">
            Unable to load workflow deliveries.
          </p>
        ) : isLoading ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            Loading workflow deliveries…
          </p>
        ) : (
          <>
            {failedCount > 0 ? (
              <div className="flex items-center gap-2 border-b border-rose-500/20 bg-rose-500/[0.06] px-3 py-2 text-xs text-rose-200">
                <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                {failedCount} failed dispatch{failedCount === 1 ? "" : "es"}{" "}
                need attention
              </div>
            ) : null}
            <EventRows events={events} emptyMessage="No workflow events yet." />
          </>
        )}
      </Card>
    </section>
  );
}

export function WorkflowEventsView() {
  const { data, isLoading, error } = useWorkflowEventDeliveries(100);
  const [filter, setFilter] = useState<EventFilter>("all");
  const events = useMemo(() => {
    const filtered = (data?.events ?? []).filter(
      (event) => filter === "all" || event.status === filter,
    );
    return sortedEvents(filtered);
  }, [data, filter]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-1">
        {(["all", "failed", "pending", "dispatched"] as EventFilter[]).map(
          (value) => (
            <Button
              key={value}
              type="button"
              variant="ghost"
              size="clear"
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-normal capitalize",
                filter === value
                  ? "bg-white/[0.08] text-white hover:bg-white/[0.08] hover:text-white"
                  : "text-white/50 hover:bg-white/[0.04] hover:text-white",
              )}
            >
              {value === "all"
                ? "All"
                : value === "pending"
                  ? "Dispatching"
                  : value}
            </Button>
          ),
        )}
        <span className="ml-auto text-[10px] text-white/35">
          {data?.computedAt ? `updated ${relativeTime(data.computedAt)}` : ""}
        </span>
      </div>
      <Card>
        {error ? (
          <p className="px-3 py-4 text-sm text-rose-200">
            Unable to load workflow events.
          </p>
        ) : isLoading ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            Loading workflow deliveries…
          </p>
        ) : (
          <EventRows
            events={events}
            emptyMessage="No workflow events match this filter."
          />
        )}
      </Card>
      <p className="mt-4 text-xs text-muted-foreground">
        These are Kody workflow dispatches caused by GitHub deliveries. They do
        not represent the final Workflow run result.
      </p>
    </div>
  );
}
