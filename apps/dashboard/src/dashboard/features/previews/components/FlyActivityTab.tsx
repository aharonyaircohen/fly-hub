"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@kody-ade/base/ui/button";

type MachineEvent = {
  app: string;
  machineId: string;
  label: string;
  state: string;
  type: string;
  source: string;
  timestamp: number;
};

export function FlyActivityTab({
  headers,
}: {
  headers: Record<string, string>;
  flyTokenConfigured: boolean;
}) {
  const [events, setEvents] = useState<MachineEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/kody/fly/activity", { headers, cache: "no-store" });
      const body = (await response.json()) as { history?: MachineEvent[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not load history.");
      setEvents(body.history ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load history.");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="fly-history">
      <div className="fly-history__intro">
        <div>
          <span className="fly-eyebrow">Recent events</span>
          <h2>Machine history</h2>
          <p>Recent starts, suspensions, and stops reported by Fly for current machines.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading} aria-label="Refresh history">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {loading && !events && <p className="text-sm text-muted-foreground">Loading history…</p>}
      {events?.length === 0 && <p className="text-sm text-muted-foreground">No machine events yet.</p>}
      {events && events.length > 0 && (
        <div className="fly-history__list">
          {events.map((event, index) => (
            <article key={`${event.app}/${event.machineId}/${event.timestamp}/${index}`} className="fly-history__row">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{event.label}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{event.app} · {event.machineId}</p>
                </div>
                <span className="text-sm font-medium capitalize">{event.state}</span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {new Date(event.timestamp).toLocaleString()} · {event.type} · {event.source}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
