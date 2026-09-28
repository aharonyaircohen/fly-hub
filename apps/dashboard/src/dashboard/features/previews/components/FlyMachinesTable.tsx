/**
 * @fileType component
 * @domain settings
 * @pattern fly-machines-table
 *
 * The operator's primary Fly view on /runner: every kody-managed machine the
 * repo's token can see, grouped by infrastructure feature, with inline
 * Suspend / Resume / Destroy. Config lives in the
 * settings cards below — this table is "what's running right now, act on it".
 *
 * Reads GET /api/kody/fly/machines. Actions use the generic Fly route.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  Download,
  ArrowLeft,
  Box,
  CalendarClock,
  Cpu,
  Loader2,
  MapPin,
  Pause,
  Play,
  Power,
  RefreshCw,
  Server,
  TerminalSquare,
  Trash2,
} from "lucide-react";

import { Button } from "@kody-ade/base/ui/button";
import { Card, CardContent } from "@kody-ade/base/ui/card";
import {
  batchSuspendRunning,
  countRunningInGroup,
} from "@kody-ade/base/infrastructure/server-machine-model";
import {
  FLY_FEATURE_TITLE,
  isServerProviderMachineRunning,
  type ServerProviderFeature,
  type ServerProviderInventory,
  type ServerProviderMachineRow,
} from "@kody-ade/base/infrastructure/server-machine-model";
import { ConfirmDialog } from "@dashboard/lib/components/ConfirmDialog";
import { EmptyState } from "@dashboard/lib/components/EmptyState";
import { MasterDetailShell } from "@dashboard/lib/components/MasterDetailShell";
import { selectionPath } from "@dashboard/lib/selection-routing";
import { useRepoScopedHref } from "@dashboard/lib/hooks/useRepoScopedHref";
import { useMediaQuery } from "@dashboard/lib/hooks/useMediaQuery";
import { cn } from "@dashboard/lib/utils";

interface FlyMachinesTableProps {
  headers: Record<string, string>;
  flyTokenConfigured: boolean;
  selectedApp?: string;
  selectedMachineId?: string;
}

// Display order + friendly group titles.
const FEATURE_ORDER: ServerProviderFeature[] = [
  "preview",
  "app",
  "runner",
  "brain",
  "browser",
  "builder",
  "preview-base",
  "other",
];
// Preview apps are throwaway per-PR environments, so their infrastructure
// action removes the whole Fly app. Other services keep the Fly app.
function destroysWholeApp(feature: ServerProviderFeature): boolean {
  return feature === "preview" || feature === "preview-base";
}

/** Compact age since creation, e.g. "2d 4h", "3h 12m", "45m", "30s". */
function formatDuration(iso?: string, now: number = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  let s = Math.max(0, Math.floor((now - t) / 1000));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s - m * 60}s`;
}

function statePill(state: string): string {
  if (state === "started" || state === "running")
    return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (state === "suspended")
    return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  if (state === "stopped") return "bg-white/5 text-white/50 border-white/10";
  return "bg-white/5 text-white/40 border-white/10";
}

interface MachineSelection {
  app: string;
  machineId: string;
}

function selectionFromPathname(pathname: string): MachineSelection | null {
  const parts = pathname.split("/").filter(Boolean);
  const flyIndex = parts.findIndex(
    (part, index) => part === "fly" && parts[index + 1] === "machines",
  );
  if (flyIndex < 0 || !parts[flyIndex + 2] || !parts[flyIndex + 3]) return null;
  try {
    return {
      app: decodeURIComponent(parts[flyIndex + 2]!),
      machineId: decodeURIComponent(parts[flyIndex + 3]!),
    };
  } catch {
    return null;
  }
}

export function FlyMachinesTable({
  headers,
  flyTokenConfigured,
  selectedApp,
  selectedMachineId,
}: FlyMachinesTableProps) {
  const scopedHref = useRepoScopedHref();
  const autoSelectFirst = useMediaQuery("(min-width: 768px)");
  const hasAuth = Object.keys(headers).length > 0;

  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ServerProviderMachineRow | null>(null);
  const [busyFeature, setBusyFeature] = useState<ServerProviderFeature | null>(
    null,
  );
  const [confirmFeature, setConfirmFeature] =
    useState<ServerProviderFeature | null>(null);
  const [search, setSearch] = useState(selectedApp ?? "");
  const [activeSelection, setActiveSelection] =
    useState<MachineSelection | null>(
      selectedApp && selectedMachineId
        ? { app: selectedApp, machineId: selectedMachineId }
        : null,
    );

  const inventoryQuery = useQuery({
    queryKey: [
      "fly-machines",
      headers["x-kody-owner"] ?? "",
      headers["x-kody-repo"] ?? "",
      headers["x-kody-user-login"] ?? "",
      flyTokenConfigured,
    ],
    enabled: hasAuth,
    staleTime: 60_000,
    refetchOnMount: false,
    queryFn: async () => {
      try {
        const repositoryResponse = flyTokenConfigured
          ? await fetch("/api/kody/fly/machines", { headers }).catch(() => null)
          : null;
        const warning =
          flyTokenConfigured && !repositoryResponse?.ok
            ? "Repository machines could not be loaded."
            : null;
        const repository = repositoryResponse?.ok
          ? ((await repositoryResponse.json()) as ServerProviderInventory)
          : null;
        const machines = repository?.machines ?? [];
        return {
          inventory: {
            machines,
            total: machines.length,
            running: machines.filter((machine) =>
              isServerProviderMachineRunning(machine.state),
            ).length,
          } satisfies ServerProviderInventory,
          warning,
        };
      } catch {
        return {
          inventory: { machines: [], total: 0, running: 0 },
          warning: "Machines could not be loaded.",
        };
      }
    },
  });
  const inv = inventoryQuery.data?.inventory ?? null;
  const inventoryError = inventoryQuery.data?.warning ?? null;
  const loading = inventoryQuery.isLoading;
  const refreshing = inventoryQuery.isFetching;
  const refetchInventory = inventoryQuery.refetch;
  const refresh = useCallback(async () => {
    await refetchInventory();
  }, [refetchInventory]);

  async function downloadSsh(row: ServerProviderMachineRow) {
    setBusyId(row.machineId);
    try {
      const response = await fetch("/api/kody/fly/machines/ssh", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ app: row.app, machineId: row.machineId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not download SSH settings");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `kody-${row.app}-${row.machineId}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("SSH settings downloaded");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not download SSH settings",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function act(
    row: ServerProviderMachineRow,
    action: "suspend" | "start" | "destroy" | "destroyApp",
  ) {
    setBusyId(row.machineId);
    try {
      const res = await fetch("/api/kody/fly/machines/action", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          app: row.app,
          machineId: row.machineId,
          action,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? `Action failed (HTTP ${res.status})`);
        return;
      }
      toast.success(
        action === "suspend"
          ? "Suspended"
          : action === "start"
            ? "Resumed"
            : "Destroyed",
      );
      await refresh();
    } catch (err) {
      toast.error(`Action failed: ${(err as Error).message}`);
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  }

  async function suspendGroup(feature: ServerProviderFeature) {
    const rows = (inv?.machines ?? []).filter((m) => m.feature === feature);
    setBusyFeature(feature);
    try {
      const { results, okCount, failCount } = await batchSuspendRunning(
        rows,
        async (row) => {
          const res = await fetch("/api/kody/fly/machines/action", {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({
              app: row.app,
              machineId: row.machineId,
              action: "suspend",
            }),
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as {
              error?: string;
            };
            throw new Error(body.error ?? `HTTP ${res.status}`);
          }
        },
      );
      if (failCount === 0) {
        toast.success(
          `Suspended ${okCount} machine(s) in ${FLY_FEATURE_TITLE[feature]}.`,
        );
      } else {
        const failedIds = results
          .filter((r) => !r.ok)
          .map((r) => r.machineId)
          .join(", ");
        toast.error(
          `Suspended ${okCount}, ${failCount} failed in ${FLY_FEATURE_TITLE[feature]}: ${failedIds}`,
        );
      }
      await refresh();
    } catch (err) {
      toast.error(`Suspend all failed: ${(err as Error).message}`);
    } finally {
      setBusyFeature(null);
      setConfirmFeature(null);
    }
  }

  const groups = useMemo(
    () =>
      FEATURE_ORDER.map((feature) => ({
        feature,
        rows: (inv?.machines ?? [])
          .filter((m) => m.feature === feature)
          .filter((m) => {
            const q = search.trim().toLowerCase();
            if (!q) return true;
            return [m.label, m.app, m.machineId, m.region, m.state, m.feature]
              .join(" ")
              .toLowerCase()
              .includes(q);
          }),
      })).filter((group) => group.rows.length > 0),
    [inv?.machines, search],
  );

  const selected = useMemo(
    () =>
      inv?.machines.find(
        (row) =>
          row.app === activeSelection?.app &&
          row.machineId === activeSelection?.machineId,
      ) ?? null,
    [activeSelection, inv],
  );
  const selectMachine = (row: ServerProviderMachineRow | null) => {
    const nextSelection = row
      ? { app: row.app, machineId: row.machineId }
      : null;
    setActiveSelection(nextSelection);
    window.history.pushState(
      null,
      "",
      nextSelection
        ? scopedHref(
            selectionPath(
              "/fly/machines",
              nextSelection.app,
              nextSelection.machineId,
            ),
          )
        : scopedHref("/fly/machines"),
    );
  };

  useEffect(() => {
    const onPopState = () =>
      setActiveSelection(selectionFromPathname(location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const filteredRows = useMemo(
    () => groups.flatMap((group) => group.rows),
    [groups],
  );

  useEffect(() => {
    if (
      loading ||
      !autoSelectFirst ||
      activeSelection ||
      filteredRows.length === 0
    ) {
      return;
    }
    const first = filteredRows[0]!;
    setActiveSelection({ app: first.app, machineId: first.machineId });
    window.history.replaceState(
      null,
      "",
      scopedHref(selectionPath("/fly/machines", first.app, first.machineId)),
    );
  }, [activeSelection, autoSelectFirst, filteredRows, loading, scopedHref]);

  const renderActions = (row: ServerProviderMachineRow) => {
    const groupBusy = busyFeature === row.feature;
    const busy = groupBusy || busyId === row.machineId;
    const running = isServerProviderMachineRunning(row.state);
    return (
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <Button
            size="default"
            variant="outline"
            disabled={busy}
            onClick={() => act(row, "suspend")}
            className="justify-center border-amber-500/30 text-amber-200 hover:bg-amber-500/10 hover:text-amber-100"
            title="Suspend (snapshot, ~$0)"
          >
            <Pause className="h-4 w-4" /> Suspend machine
          </Button>
        ) : (
          <Button
            size="default"
            disabled={busy}
            onClick={() => act(row, "start")}
            title="Resume"
          >
            <Play className="h-4 w-4" /> Resume machine
          </Button>
        )}
        <Button
          size="default"
          variant="outline"
          disabled={busy || !row.sshConfigured}
          onClick={() => downloadSsh(row)}
          title={
            row.sshConfigured
              ? "Download SSH configuration"
              : "SSH was not configured when this machine was created"
          }
        >
          <Download className="h-4 w-4" /> Download SSH config
        </Button>
      </div>
    );
  };

  return (
    <>
      <MasterDetailShell
        title="Fly Machines"
        icon={Server}
        iconClassName="text-sky-400"
        subtitle={`${inv?.total ?? 0} machines${inv ? ` · ${inv.running} running` : ""}`}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search machines..."
        searchAriaLabel="Search machines"
        accent="sky"
        hasSelection={selected !== null}
        listWidth="md:w-72"
        listAside={
          inv ? (
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md bg-muted/40 px-2 py-2">
                <div className="text-base font-semibold text-foreground">
                  {inv.total}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Total
                </div>
              </div>
              <div className="rounded-md bg-emerald-500/10 px-2 py-2">
                <div className="text-base font-semibold text-emerald-300">
                  {inv.running}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-emerald-300/70">
                  Running
                </div>
              </div>
              <div className="rounded-md bg-muted/40 px-2 py-2">
                <div className="text-base font-semibold text-foreground">
                  {inv.total - inv.running}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Stopped
                </div>
              </div>
            </div>
          ) : null
        }
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={refresh}
            disabled={refreshing || !hasAuth}
            aria-label="Refresh machines"
          >
            {refreshing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </Button>
        }
        detail={
          selected ? (
            <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-5 p-4 md:p-5">
              <Button
                variant="ghost"
                size="sm"
                className="w-fit gap-1 md:hidden"
                onClick={() => selectMachine(null)}
              >
                <ArrowLeft className="h-4 w-4" /> Back to machines
              </Button>

              <div className="flex min-w-0 flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${statePill(selected.state)}`}
                    >
                      {selected.state}
                    </span>
                    <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
                      {FLY_FEATURE_TITLE[selected.feature]}
                    </span>
                  </div>
                  <h2 className="truncate text-2xl font-semibold text-foreground">
                    {selected.label}
                  </h2>
                  <p className="mt-1 truncate font-mono text-sm text-muted-foreground">
                    {selected.app}
                  </p>
                </div>
                {renderActions(selected)}
              </div>

              <section
                aria-labelledby="machine-overview-heading"
                className="space-y-3"
              >
                <div>
                  <h3
                    id="machine-overview-heading"
                    className="text-sm font-semibold text-foreground"
                  >
                    Machine overview
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    The current Fly allocation and lifecycle state.
                  </p>
                </div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3">
                  {[
                    { label: "Status", value: selected.state, icon: Activity },
                    {
                      label: "Region",
                      value: selected.region || "Unknown",
                      icon: MapPin,
                    },
                    {
                      label: "Machine size",
                      value: selected.sizeLabel || "Unknown",
                      icon: Cpu,
                    },
                    {
                      label: "Age",
                      value: formatDuration(selected.createdAt),
                      icon: CalendarClock,
                    },
                  ].map(({ label, value, icon: Icon }) => (
                    <Card
                      key={label}
                      className="border-border bg-card/40 shadow-none"
                    >
                      <CardContent className="flex items-start gap-3 p-4">
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
                        <div className="min-w-0">
                          <div className="text-xs text-muted-foreground">
                            {label}
                          </div>
                          <div className="mt-1 truncate text-sm font-medium text-foreground">
                            {value}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>

              <div className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-4">
                <Card className="border-border bg-card/40 shadow-none">
                  <CardContent className="space-y-4 p-5">
                    <div className="flex items-start gap-3">
                      <Box className="mt-0.5 h-4 w-4 text-sky-400" />
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">
                          Identity
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          Use these values when matching logs or Fly activity.
                        </p>
                      </div>
                    </div>
                    <dl className="space-y-3 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Machine ID
                        </dt>
                        <dd className="mt-1 break-all font-mono text-foreground">
                          {selected.machineId}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">App</dt>
                        <dd className="mt-1 break-all font-mono text-foreground">
                          {selected.app}
                        </dd>
                      </div>
                    </dl>
                  </CardContent>
                </Card>

                <Card className="border-border bg-card/40 shadow-none">
                  <CardContent className="space-y-4 p-5">
                    <div className="flex items-start gap-3">
                      <TerminalSquare className="mt-0.5 h-4 w-4 text-sky-400" />
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">
                          SSH access
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {selected.sshConfigured
                            ? "This machine has a downloadable SSH profile."
                            : "SSH was not prepared when this machine was created."}
                        </p>
                      </div>
                    </div>
                    <div
                      className={cn(
                        "rounded-md border px-3 py-2 text-sm",
                        selected.sshConfigured
                          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                          : "border-amber-500/20 bg-amber-500/10 text-amber-200",
                      )}
                    >
                      {selected.sshConfigured
                        ? "Ready to download"
                        : "Unavailable for this machine"}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <section
                aria-labelledby="machine-danger-heading"
                className="rounded-lg border border-rose-500/20 bg-rose-500/[0.04] p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
                    <div>
                      <h3
                        id="machine-danger-heading"
                        className="text-sm font-semibold text-foreground"
                      >
                        Destroy machine
                      </h3>
                      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                        {destroysWholeApp(selected.feature)
                          ? "Removes the whole preview app. It can be rebuilt from the pull request."
                          : "Removes this machine. Long-lived services can provision another machine when needed."}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    disabled={busyId === selected.machineId}
                    onClick={() => setConfirm(selected)}
                    className="shrink-0 border-rose-500/30 text-rose-200 hover:bg-rose-500/10 hover:text-rose-100"
                  >
                    {busyId === selected.machineId ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Destroy machine
                  </Button>
                </div>
              </section>
            </div>
          ) : (
            <EmptyState
              icon={<Server />}
              title="Select a machine"
              hint="Pick one from the list to inspect its status and actions."
            />
          )
        }
      >
        <div>
          {inventoryError && (
            <div
              role="alert"
              className="m-3 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
            >
              {inventoryError}
            </div>
          )}

          {!flyTokenConfigured && (
            <div className="m-3 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              Add <span className="font-mono">FLY_API_TOKEN</span> in Secrets to
              show repository infrastructure.
            </div>
          )}

          {loading && !inv ? (
            <EmptyState
              icon={<Loader2 className="animate-spin" />}
              title="Loading machines..."
            />
          ) : inv && groups.length === 0 && !inventoryError ? (
            <EmptyState
              icon={<Server />}
              title={search ? "No matching machines" : "No machines found"}
              hint={
                search
                  ? `Nothing matched “${search}”.`
                  : "Kody has no Fly machines to manage here."
              }
            />
          ) : null}

          {groups.map(({ feature, rows }) => {
            const runningInGroup = countRunningInGroup(rows);
            const groupBusy = busyFeature === feature;
            return (
              <section key={feature} aria-label={FLY_FEATURE_TITLE[feature]}>
                <div className="flex min-h-10 items-center gap-2 border-y border-border bg-muted/20 px-4 py-2 first:border-t-0">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {FLY_FEATURE_TITLE[feature]}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {rows.length}
                  </span>
                  {runningInGroup > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={groupBusy}
                      onClick={() => setConfirmFeature(feature)}
                      className="ml-auto h-7 px-2 text-xs text-amber-300 hover:bg-amber-500/10 hover:text-amber-200"
                      title="Suspend all running machines in this section"
                    >
                      {groupBusy ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <Power className="w-3 h-3 mr-1" />
                      )}
                      Suspend all
                    </Button>
                  )}
                </div>
                <div className="divide-y divide-border">
                  {rows.map((row) => {
                    const active =
                      selected?.app === row.app &&
                      selected.machineId === row.machineId;
                    const running = isServerProviderMachineRunning(row.state);
                    return (
                      // eslint-disable-next-line react/forbid-elements -- full-width selectable list row; shared Button centers content and cannot express this list-item layout
                      <button
                        type="button"
                        key={row.machineId}
                        className={cn(
                          "block w-full px-4 py-3 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/50",
                          active && "bg-sky-500/10",
                        )}
                        onClick={() => selectMachine(row)}
                        aria-label={`Select ${row.label}`}
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <span
                            className={cn(
                              "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                              running
                                ? "bg-emerald-400"
                                : row.state === "suspended"
                                  ? "bg-amber-400"
                                  : "bg-muted-foreground/50",
                            )}
                            aria-hidden="true"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-sm font-medium text-foreground">
                                {row.label}
                              </span>
                              <span className="ml-auto shrink-0 text-xs capitalize text-muted-foreground">
                                {row.state}
                              </span>
                            </div>
                            <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                              {row.app}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span>{row.region || "Unknown region"}</span>
                              <span>{row.sizeLabel || "Unknown size"}</span>
                              <span>{formatDuration(row.createdAt)}</span>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </MasterDetailShell>

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm?.feature === "browser"
            ? `Destroy browser ${confirm.label}?`
            : confirm && destroysWholeApp(confirm.feature)
              ? `Destroy preview ${confirm.label}?`
              : `Destroy ${confirm?.label ?? "machine"}?`
        }
        description={
          confirm?.feature === "browser"
            ? "Destroys this user's browser machine. The stable repository browser app remains available and creates a fresh machine on next use."
            : confirm && destroysWholeApp(confirm.feature)
              ? "Tears down the whole preview app (URL + IPs). It rebuilds on the next PR sync."
              : "Destroys this machine. Long-lived apps re-provision on next use."
        }
        confirmLabel="Destroy"
        variant="destructive"
        onConfirm={() =>
          confirm &&
          act(
            confirm,
            destroysWholeApp(confirm.feature) ? "destroyApp" : "destroy",
          )
        }
        onClose={() => setConfirm(null)}
      />

      <ConfirmDialog
        open={confirmFeature !== null}
        title={
          confirmFeature
            ? `Suspend all in ${FLY_FEATURE_TITLE[confirmFeature]}?`
            : "Suspend all?"
        }
        description={
          confirmFeature
            ? `Suspends ${countRunningInGroup(
                (inv?.machines ?? []).filter(
                  (m) => m.feature === confirmFeature,
                ),
              )} running machine(s) in ${FLY_FEATURE_TITLE[confirmFeature]}. Already-suspended machines are skipped.`
            : ""
        }
        confirmLabel="Suspend all"
        onConfirm={() => confirmFeature && suspendGroup(confirmFeature)}
        onClose={() => setConfirmFeature(null)}
      />
    </>
  );
}
