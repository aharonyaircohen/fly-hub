"use client";

import { Server, Settings2 } from "lucide-react";
import { FlyMachinesTable } from "@dashboard/features/previews/components/FlyMachinesTable";
import { FlyActivityTab } from "@dashboard/features/previews/components/FlyActivityTab";
import { PageShell } from "@dashboard/lib/components/PageShell";

export type RunnerView = "config" | "previews" | "machines" | "history";

interface RunnerManagerProps {
  view?: RunnerView;
  selectedApp?: string;
  selectedMachineId?: string;
}

const headers: Record<string, string> = {};

export function RunnerManager({
  view = "machines",
  selectedApp,
  selectedMachineId,
}: RunnerManagerProps) {
  if (view === "machines") {
    return (
      <FlyMachinesTable
        headers={headers}
        flyTokenConfigured
        selectedApp={selectedApp}
        selectedMachineId={selectedMachineId}
      />
    );
  }

  if (view === "history") {
    return (
      <PageShell title="Machine history" icon={Server} backHref={null} width="wide">
        <FlyActivityTab headers={headers} flyTokenConfigured />
      </PageShell>
    );
  }

  return (
    <PageShell title="Settings" icon={Settings2} backHref={null} width="wide">
      <section className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Fly connection</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your Fly token is connected and remembered on this browser for 30 days.
          Use Disconnect above to remove it or connect with a different token.
        </p>
      </section>
    </PageShell>
  );
}
