/**
 * @fileType component
 * @domain settings
 * @pattern fly-machines-table
 *
 * Fly Hub's primary machine view: the connected repository's Kody-managed
 * Fly machines, with SSH download and lifecycle actions for the selected item.
 *
 * Reads GET /api/kody/fly/machines. Actions use the generic Fly route.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Download,
  ArrowLeft,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";

import { Button } from "@kody-ade/base/ui/button";
import {
  isServerProviderMachineRunning,
  type ServerProviderInventory,
  type ServerProviderMachineRow,
} from "@kody-ade/base/infrastructure/server-machine-model";
import { ConfirmDialog } from "@dashboard/lib/components/ConfirmDialog";
import { EmptyState } from "@dashboard/lib/components/EmptyState";
import { MasterDetailShell } from "@dashboard/lib/components/MasterDetailShell";
import { PageShell } from "@dashboard/lib/components/PageShell";
import { selectionPath } from "@dashboard/lib/selection-routing";
import { useRepoScopedHref } from "@dashboard/lib/hooks/useRepoScopedHref";
import { useMediaQuery } from "@dashboard/lib/hooks/useMediaQuery";
import { RepoScopedLink } from "@dashboard/lib/components/RepoScopedLink";
import { cn } from "@dashboard/lib/utils";
import { FlyMachineCreateDialog, type CreatedFlyMachine } from "./FlyMachineCreateDialog";

interface FlyMachinesTableProps {
  headers: Record<string, string>;
  flyTokenConfigured: boolean;
  selectedApp?: string;
  selectedMachineId?: string;
}

// Preview apps are throwaway per-PR environments, so their infrastructure
// action removes the whole Fly app. Other services keep the Fly app.
function destroysWholeApp(row: ServerProviderMachineRow): boolean {
  return row.feature === "preview" || row.feature === "preview-base";
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
  const hasAuth = flyTokenConfigured;

  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirm, setConfirm] = useState<ServerProviderMachineRow | null>(null);
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
            ? "Fly machines could not be loaded."
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
      link.download = `flyhub-${row.app}-${row.machineId}.zip`;
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

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (inv?.machines ?? [])
      .filter((m) =>
        !q || [m.label, m.app, m.machineId, m.region, m.state, m.feature]
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
      .sort((a, b) =>
        Number(isServerProviderMachineRunning(b.state)) -
          Number(isServerProviderMachineRunning(a.state)) ||
        a.label.localeCompare(b.label),
      );
  }, [inv?.machines, search]);

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
  const onCreated = async (machine: CreatedFlyMachine) => {
    setActiveSelection({ app: machine.app, machineId: machine.machineId });
    window.history.pushState(
      null,
      "",
      scopedHref(selectionPath("/fly/machines", machine.app, machine.machineId)),
    );
    await refresh();
    toast.success("Machine created. SSH settings are ready to download.");
  };

  useEffect(() => {
    const onPopState = () =>
      setActiveSelection(selectionFromPathname(location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

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
    const busy = busyId === row.machineId;
    const running = isServerProviderMachineRunning(row.state);
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="default"
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
        {running ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => act(row, "suspend")}
            title="Suspend (snapshot, ~$0)"
          >
            <Pause className="h-4 w-4" /> Suspend machine
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => act(row, "start")}
            title="Resume"
          >
            <Play className="h-4 w-4" /> Resume machine
          </Button>
        )}
      </div>
    );
  };

  if (!loading && inv?.total === 0 && flyTokenConfigured && !inventoryError) {
    return (
      <><div className="fly-machine-empty"><PageShell
        title="Machines"
        className="fly-page-header"
        icon={Server}
        iconClassName="text-sky-400"
        subtitle="0 machines"
        backHref={null}
        actions={<div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Create machine</Button>
          <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing} className="gap-2">
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>}
        contentClassName="flex items-center justify-center"
      >
        <div className="fly-empty-panel">
          <div className="fly-empty-panel__icon"><Server size={28} /></div>
          <span className="fly-eyebrow">Inventory / empty</span>
          <h2>No machines yet</h2>
          <p>
            Machines created with this Fly token will appear here.
          </p>
          <Button className="mt-6" onClick={() => setCreateOpen(true)}>Create machine</Button>
        </div>
      </PageShell></div>
      <FlyMachineCreateDialog open={createOpen} onOpenChange={setCreateOpen} headers={headers} onCreated={onCreated} />
      </>
    );
  }

  return (
    <>
      <MasterDetailShell
        className="fly-machine-shell"
        title="Machines"
        backHref={null}
        icon={Server}
        iconClassName="text-sky-400"
        subtitle={inv ? `${inv.running} running · ${inv.total} total` : "Current machine inventory"}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search machines..."
        searchAriaLabel="Search machines"
        accent="sky"
        hasSelection={selected !== null}
        listWidth="md:w-72"
        actions={<div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Create machine</Button>
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
        </div>}
        detail={
          selected ? (
            <div className="fly-machine-detail">
              <Button
                variant="ghost"
                size="sm"
                className="w-fit gap-1 md:hidden"
                onClick={() => selectMachine(null)}
              >
                <ArrowLeft className="h-4 w-4" /> Back to machines
              </Button>

              <div className="fly-machine-hero">
                <div className="min-w-0">
                  <div className="fly-machine-hero__eyebrow">
                    <span className="fly-eyebrow">Machine / {selected.region || "unknown region"}</span>
                    <span className={`fly-state fly-state--${isServerProviderMachineRunning(selected.state) ? "running" : "inactive"}`}>
                      <span className="fly-state__dot" />{selected.state}
                    </span>
                  </div>
                  <h2>
                    {selected.label}
                  </h2>
                  <p className="fly-machine-hero__app">
                    {selected.app}
                  </p>
                </div>
              </div>

              <div className="fly-machine-toolbar">{renderActions(selected)}</div>

              {!selected.sshConfigured && (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  SSH configuration was not prepared when this machine was created.
                </p>
              )}

              <section aria-labelledby="machine-overview-heading" className="fly-machine-specs">
                <div className="fly-section-heading"><span className="fly-eyebrow">01 / configuration</span><h3 id="machine-overview-heading">Machine overview</h3></div>
                <dl>
                  <div>
                    <dt className="text-muted-foreground">Region</dt>
                    <dd className="mt-1 font-medium text-foreground">{selected.region || "Unknown"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Size</dt>
                    <dd className="mt-1 font-medium text-foreground">{selected.sizeLabel || "Unknown"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Created</dt>
                    <dd className="mt-1 font-medium text-foreground">
                      {selected.createdAt ? `${formatDuration(selected.createdAt)} ago` : "Unknown"}
                    </dd>
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <dt className="text-muted-foreground">Machine ID</dt>
                    <dd className="mt-1 break-all font-mono text-foreground">{selected.machineId}</dd>
                  </div>
                </dl>
              </section>

              <section
                aria-labelledby="machine-danger-heading"
                className="fly-danger-panel"
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
                        {destroysWholeApp(selected)
                          ? "Removes the whole preview app. It can be rebuilt from the pull request."
                          : "Removes this machine. Long-lived services can provision another machine when needed."}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    disabled={busyId === selected.machineId}
                    onClick={() => setConfirm(selected)}
                    className="shrink-0 text-destructive"
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
              title={flyTokenConfigured ? "Select a machine" : "Connect Fly to get started"}
              hint={flyTokenConfigured
                ? "Pick one from the list to see its status and SSH access."
                : "Open Settings to connect this repository."}
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

          {!flyTokenConfigured && !loading && (
            <div className="m-3 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              Connect Fly in <RepoScopedLink href="/fly/config" className="font-medium underline">Settings</RepoScopedLink> to see this repository&apos;s machines.
            </div>
          )}

          {loading && !inv ? (
            <EmptyState
              icon={<Loader2 className="animate-spin" />}
              title="Loading machines..."
            />
          ) : inv && filteredRows.length === 0 && !inventoryError && flyTokenConfigured ? (
            <EmptyState
              icon={<Server />}
              title={search ? "No matching machines" : "No machines yet"}
              hint={
                search
                  ? `Nothing matched “${search}”.`
                  : "Machines created with this Fly token will appear here."
              }
            />
          ) : null}

          <div className="divide-y divide-border">
            {filteredRows.map((row) => {
              const active = selected?.app === row.app && selected.machineId === row.machineId;
              const running = isServerProviderMachineRunning(row.state);
              return (
                // eslint-disable-next-line react/forbid-elements -- full-width selectable list row; shared Button centers content and cannot express this list-item layout
                <button
                  type="button"
                  key={`${row.app}/${row.machineId}`}
                  className={cn("fly-machine-row", active && "is-active")}
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
                        <span className="truncate text-sm font-medium text-foreground">{row.label}</span>
                        <span className="ml-auto shrink-0 text-xs capitalize text-muted-foreground">{row.state}</span>
                      </div>
                      <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{row.app}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{row.region || "Unknown region"}</span>
                        <span>{row.sshConfigured ? "SSH ready" : "No SSH"}</span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </MasterDetailShell>

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm?.feature === "browser"
            ? `Destroy browser ${confirm.label}?`
            : confirm && destroysWholeApp(confirm)
              ? `Destroy preview ${confirm.label}?`
              : `Destroy ${confirm?.label ?? "machine"}?`
        }
        description={
          confirm?.feature === "browser"
            ? "Destroys this user's browser machine. The stable repository browser app remains available and creates a fresh machine on next use."
            : confirm && destroysWholeApp(confirm)
              ? "Tears down the whole preview app (URL + IPs). It rebuilds on the next PR sync."
              : "Destroys this machine. Long-lived apps re-provision on next use."
        }
        confirmLabel="Destroy"
        variant="destructive"
        onConfirm={() =>
          confirm &&
          act(
            confirm,
            destroysWholeApp(confirm) ? "destroyApp" : "destroy",
          )
        }
        onClose={() => setConfirm(null)}
      />

      <FlyMachineCreateDialog open={createOpen} onOpenChange={setCreateOpen} headers={headers} onCreated={onCreated} />

    </>
  );
}
