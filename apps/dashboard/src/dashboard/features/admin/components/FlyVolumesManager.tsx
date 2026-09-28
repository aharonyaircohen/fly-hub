/**
 * @fileType component
 * @domain infrastructure
 * @pattern fly-volumes-manager
 * @ai-summary Repository Fly volume inventory with safe snapshot and delete actions.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HardDrive, Loader2 } from "lucide-react";
import { Button } from "@kody-ade/base/ui/button";
import { buildAuthHeaders, useAuth } from "@dashboard/lib/auth-context";
import { useFlyTokenStatus } from "@dashboard/lib/hooks/useFlyTokenStatus";
import { PageShell } from "@dashboard/lib/components/PageShell";
import { VaultLockedBanner } from "@dashboard/lib/components/VaultLockedBanner";

type FlyVolume = {
  app: string;
  id: string;
  name: string;
  region: string;
  state: string;
  sizeGb: number;
  encrypted: boolean;
  attachedMachineId: string | null;
  createdAt: string | null;
};

export function FlyVolumesManager() {
  const { auth } = useAuth();
  const headers = useMemo(() => buildAuthHeaders(auth), [auth]);
  const token = useFlyTokenStatus(headers);
  const [volumes, setVolumes] = useState<FlyVolume[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    if (!token.configured) {
      setLoading(false);
      return;
    }
    setError(undefined);
    try {
      const response = await fetch("/api/kody/fly/volumes", { headers });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body.message ?? body.error ?? "Volumes unavailable");
      setVolumes(body.volumes ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Volumes unavailable");
    } finally {
      setLoading(false);
    }
  }, [headers, token.configured]);

  useEffect(() => {
    if (token.loading) return;
    void load();
  }, [load, token.loading]);

  const act = async (volume: FlyVolume, action: "snapshot" | "delete") => {
    if (
      action === "delete" &&
      !window.confirm(`Permanently delete detached volume ${volume.name}?`)
    )
      return;
    setBusy(volume.id);
    setMessage(undefined);
    try {
      const response = await fetch("/api/kody/fly/volumes", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          app: volume.app,
          volumeId: volume.id,
          action,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body.message ?? body.error ?? "Volume action failed");
      setMessage(
        action === "snapshot" ? "Snapshot created." : "Volume deleted.",
      );
      await load();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Volume action failed",
      );
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <PageShell
      title="Fly Volumes"
      icon={HardDrive}
      iconClassName="text-sky-400"
      subtitle="Persistent disks used by Fly apps."
    >
      <VaultLockedBanner feature="Fly volumes stay unavailable until the repository vault can be read." />
      {message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading || token.loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading volumes…
        </div>
      ) : !token.configured ? (
        <p className="text-sm text-muted-foreground">
          Add FLY_API_TOKEN to repository Secrets to view Fly volumes.
        </p>
      ) : volumes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No persistent volumes.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          {volumes.map((volume) => {
            const attached = Boolean(volume.attachedMachineId);
            return (
              <section
                key={`${volume.app}:${volume.id}`}
                className="flex flex-wrap items-center justify-between gap-4 border-b p-4 last:border-b-0"
              >
                <div className="min-w-0">
                  <h2 className="font-medium">{volume.name}</h2>
                  <p className="break-all text-sm text-muted-foreground">
                    {volume.app}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {volume.sizeGb} GB · {volume.region} ·{" "}
                    {volume.encrypted ? "Encrypted" : "Not encrypted"} ·{" "}
                    {attached ? "Attached" : "Detached"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label="Snapshot volume"
                    disabled={Boolean(busy)}
                    onClick={() => void act(volume, "snapshot")}
                  >
                    Snapshot
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    aria-label="Delete volume"
                    disabled={Boolean(busy) || attached}
                    title={
                      attached
                        ? "Detach the volume before deleting it"
                        : undefined
                    }
                    onClick={() => void act(volume, "delete")}
                  >
                    Delete
                  </Button>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
