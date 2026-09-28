/**
 * @fileType component
 * @domain brain
 * @pattern brain-images-manager
 *
 * Dedicated management surface for saved Brain container images.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@kody-ade/base/ui/button";
import { Card, CardContent } from "@kody-ade/base/ui/card";
import { buildAuthHeaders, useAuth } from "@dashboard/lib/auth-context";
import { ConfirmDialog } from "@dashboard/lib/components/ConfirmDialog";
import { PageShell } from "@dashboard/lib/components/PageShell";

interface BrainSavedImage {
  imageRef: string;
  createdAt: string;
  updatedAt: string;
}

interface BrainImageSaveState {
  status: "running" | "completed" | "failed";
  phase?:
    | "starting"
    | "uploading-script"
    | "exporting-rootfs"
    | "downloading-rootfs"
    | "preparing-push"
    | "pushing-image"
    | "verifying"
    | "completed"
    | "failed";
  message?: string;
  heartbeatAt?: string;
  lastOutput?: string;
  jobId: string;
  imageRef: string;
  startedAt: string;
  updatedAt: string;
  error?: string;
}

interface BrainImagesResponse {
  ok?: boolean;
  status?: "running" | "completed" | "failed";
  runningImageRef?: string | null;
  runningAt?: string | null;
  runningApp?: string | null;
  runningMachineId?: string | null;
  machineImageRef?: string | null;
  machineState?: string | null;
  images?: BrainSavedImage[];
  save?: BrainImageSaveState | null;
  runtime?: {
    operation?: {
      type?: "apply-image" | "save-image";
      status?: "running" | "completed" | "failed";
      stage?:
        | "validating"
        | "resolving-image"
        | "resolving-service"
        | "provisioning"
        | "installing-agent-access"
        | "preparing-runtime-image"
        | "verifying-health"
        | "recording-runtime"
        | "recovering-previous";
      attempt?: number;
      imageRef?: string;
      startedAt?: string;
      updatedAt?: string;
      error?: string;
    };
  } | null;
  message?: string;
  error?: string;
}

interface BrainImageSavePollResponse {
  ok?: boolean;
  status?: "idle" | "running" | "completed" | "failed";
  phase?: BrainImageSaveState["phase"];
  message?: string;
  heartbeatAt?: string;
  lastOutput?: string;
  jobId?: string;
  imageRef?: string;
  startedAt?: string;
  updatedAt?: string;
  error?: string;
}

interface BrainImageApplyState {
  imageRef: string;
  status: "running" | "failed";
  startedAt: string;
  error?: string;
  message?: string;
}

function imageTag(imageRef: string): string {
  const withoutDigest = imageRef.split("@")[0] ?? imageRef;
  const marker = withoutDigest.lastIndexOf(":");
  return marker === -1 ? imageRef : withoutDigest.slice(marker + 1);
}

function packageName(imageRef: string): string {
  const withoutTag = imageRef.split("@")[0]?.split(":")[0] ?? imageRef;
  return withoutTag.split("/").slice(-1)[0] ?? imageRef;
}

function imageLabel(imageRef: string): string {
  return `${packageName(imageRef)}:${imageTag(imageRef)}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function phaseLabel(save: BrainImageSaveState): string {
  if (save.message) return save.message;
  switch (save.phase) {
    case "uploading-script":
      return "Preparing the Brain machine for export";
    case "exporting-rootfs":
      return "Exporting the Brain filesystem";
    case "downloading-rootfs":
      return "Downloading the Brain filesystem";
    case "preparing-push":
      return "Preparing the image upload";
    case "pushing-image":
      return "Pushing the Brain image to GHCR";
    case "verifying":
      return "Verifying saved image";
    case "completed":
      return "Brain image saved";
    case "failed":
      return "Brain image save failed";
    case "starting":
    default:
      return "Starting Brain image save";
  }
}

function elapsedLabel(startedAt: string, updatedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = updatedAt ? new Date(updatedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return "";
  }
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s elapsed`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${minutes}m ${rest}s elapsed`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m elapsed`;
}

function liveSignalLabel(heartbeatAt?: string): string | null {
  if (!heartbeatAt) return null;
  const heartbeat = new Date(heartbeatAt).getTime();
  const now = Date.now();
  if (!Number.isFinite(heartbeat) || heartbeat > now) return null;
  const seconds = Math.max(0, Math.round((now - heartbeat) / 1000));
  if (seconds < 60) return `live signal ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `live signal ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `live signal ${hours}h ${minutes % 60}m ago`;
}

export function BrainImagesManager() {
  const { auth } = useAuth();
  const headers = useMemo(() => (auth ? buildAuthHeaders(auth) : {}), [auth]);
  const [images, setImages] = useState<BrainSavedImage[]>([]);
  const [runningImageRef, setRunningImageRef] = useState<string | null>(null);
  const [runningAt, setRunningAt] = useState<string | null>(null);
  const [machineImageRef, setMachineImageRef] = useState<string | null>(null);
  const [machineState, setMachineState] = useState<string | null>(null);
  const [save, setSave] = useState<BrainImageSaveState | null>(null);
  const [applyState, setApplyState] = useState<BrainImageApplyState | null>(
    null,
  );
  const applyStateRef = useRef<BrainImageApplyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyRef, setBusyRef] = useState<string | null>(null);
  const [pendingApplyRef, setPendingApplyRef] = useState<string | null>(null);
  const [pendingDeleteRef, setPendingDeleteRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadImages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/kody/brain/image", {
        headers,
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as BrainImagesResponse;
      if (!res.ok) {
        throw new Error(
          body.message ?? body.error ?? `Load failed (${res.status})`,
        );
      }
      setImages(body.images ?? []);
      setRunningImageRef(body.runningImageRef ?? null);
      setRunningAt(body.runningAt ?? null);
      setMachineImageRef(body.machineImageRef ?? null);
      setMachineState(body.machineState ?? null);
      setSave(body.save ?? null);
      const operation = body.runtime?.operation;
      if (
        operation?.type === "apply-image" &&
        operation.status === "running" &&
        operation.imageRef
      ) {
        setApplyState({
          imageRef: operation.imageRef,
          status: "running",
          startedAt: operation.startedAt ?? new Date().toISOString(),
          message: restoreStageMessage(operation.stage, operation.attempt),
        });
      } else if (
        operation?.type === "apply-image" &&
        operation.status === "failed" &&
        operation.imageRef
      ) {
        setApplyState({
          imageRef: operation.imageRef,
          status: "failed",
          startedAt: operation.startedAt ?? new Date().toISOString(),
          error: operation.error,
        });
      } else if (operation?.type === "apply-image") {
        const activeApply = applyStateRef.current;
        const completedCurrentApply =
          activeApply?.status === "running" &&
          activeApply.imageRef === operation.imageRef &&
          operation.status === "completed" &&
          (!activeApply.startedAt ||
            !operation.updatedAt ||
            operation.updatedAt >= activeApply.startedAt);
        if (completedCurrentApply) {
          window.dispatchEvent(
            new CustomEvent("kody:brain-runtime-change", {
              detail: { phase: "complete", imageRef: operation.imageRef },
            }),
          );
          toast.success("Brain image applied");
          setApplyState(null);
        } else if (operation.status !== "completed") {
          setApplyState(null);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load images");
      setImages([]);
      setRunningImageRef(null);
      setRunningAt(null);
      setMachineImageRef(null);
      setMachineState(null);
      setSave(null);
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    applyStateRef.current = applyState;
  }, [applyState]);

  const pollSave = useCallback(
    async (jobId: string) => {
      if (!headers) return;
      try {
        const res = await fetch(
          `/api/kody/brain/image?jobId=${encodeURIComponent(jobId)}`,
          {
            headers,
            cache: "no-store",
            signal: AbortSignal.timeout(30_000),
          },
        );
        const body = (await res
          .json()
          .catch(() => ({}))) as BrainImageSavePollResponse;
        if (!res.ok && body.status !== "failed") {
          throw new Error(
            body.message ?? body.error ?? `Poll failed (${res.status})`,
          );
        }
        if (body.status === "idle") {
          setSave(null);
          return;
        }
        if (body.status === "completed") {
          setSave(null);
          await loadImages();
          return;
        }
        if (body.status === "failed") {
          setSave((prev) =>
            prev
              ? {
                  ...prev,
                  status: "failed",
                  phase: "failed",
                  message: body.message ?? prev.message,
                  heartbeatAt: body.heartbeatAt ?? prev.heartbeatAt,
                  lastOutput: body.lastOutput ?? prev.lastOutput,
                  updatedAt: body.updatedAt ?? new Date().toISOString(),
                  error: body.error ?? body.message,
                }
              : prev,
          );
          return;
        }
        if (body.status === "running") {
          setSave((prev) =>
            prev
              ? {
                  ...prev,
                  status: "running",
                  phase: body.phase ?? prev.phase,
                  message: body.message ?? prev.message,
                  heartbeatAt: body.heartbeatAt ?? prev.heartbeatAt,
                  lastOutput: body.lastOutput ?? prev.lastOutput,
                  updatedAt: body.updatedAt ?? new Date().toISOString(),
                }
              : {
                  status: "running",
                  phase: body.phase ?? "starting",
                  message: body.message,
                  heartbeatAt: body.heartbeatAt,
                  lastOutput: body.lastOutput,
                  jobId: body.jobId ?? jobId,
                  imageRef: body.imageRef ?? "",
                  startedAt: body.startedAt ?? new Date().toISOString(),
                  updatedAt: body.updatedAt ?? new Date().toISOString(),
                },
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Brain image save failed";
        setError(message);
        await loadImages();
      }
    },
    [headers, loadImages],
  );

  const pendingApplyImage = useMemo(
    () => images.find((image) => image.imageRef === pendingApplyRef) ?? null,
    [images, pendingApplyRef],
  );
  const pendingApplyIsRunning =
    pendingApplyRef !== null && pendingApplyRef === runningImageRef;
  const pendingDeleteImage = useMemo(
    () => images.find((image) => image.imageRef === pendingDeleteRef) ?? null,
    [images, pendingDeleteRef],
  );
  const runningImage = useMemo(
    () => images.find((image) => image.imageRef === runningImageRef) ?? null,
    [images, runningImageRef],
  );
  const runningNeedsMachineProof =
    runningImageRef !== null && machineImageRef === null;

  useEffect(() => {
    void loadImages();
  }, [loadImages]);

  useEffect(() => {
    const refreshOnFocus = () => {
      if (document.visibilityState === "visible") void loadImages();
    };
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [loadImages]);

  useEffect(() => {
    if (save?.status !== "running") return;
    const interval = window.setInterval(() => void pollSave(save.jobId), 5000);
    return () => window.clearInterval(interval);
  }, [pollSave, save?.jobId, save?.status]);

  useEffect(() => {
    if (applyState?.status !== "running") return;
    const interval = window.setInterval(() => void loadImages(), 5000);
    return () => window.clearInterval(interval);
  }, [applyState?.status, loadImages]);

  async function applyImage(imageRef: string, reset = false) {
    if (!headers) return;
    const startedAt = new Date().toISOString();
    setApplyState({ imageRef, status: "running", startedAt });
    window.dispatchEvent(
      new CustomEvent("kody:brain-runtime-change", {
        detail: { phase: "start", imageRef },
      }),
    );
    setBusyRef(imageRef);
    try {
      const res = await fetch("/api/kody/brain/image/apply", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ imageRef, reset }),
      });
      const body = (await res.json().catch(() => ({}))) as BrainImagesResponse;
      if (!res.ok) {
        throw new Error(
          body.message ?? body.error ?? `Apply failed (${res.status})`,
        );
      }
      if (res.status !== 202 && body.status !== "running") {
        await loadImages();
        window.dispatchEvent(new Event("kody:fly-machines-refresh"));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Apply failed";
      setApplyState({ imageRef, status: "failed", startedAt, error: message });
      window.dispatchEvent(
        new CustomEvent("kody:brain-runtime-change", {
          detail: { phase: "failed", imageRef },
        }),
      );
      toast.error(message);
    } finally {
      setBusyRef(null);
    }
  }

  function requestApplyImage(imageRef: string) {
    setPendingApplyRef(imageRef);
  }

  async function deleteImage(imageRef: string) {
    if (!headers) return;
    setBusyRef(imageRef);
    try {
      const res = await fetch(
        `/api/kody/brain/image?imageRef=${encodeURIComponent(imageRef)}`,
        { method: "DELETE", headers },
      );
      const body = (await res.json().catch(() => ({}))) as BrainImagesResponse;
      if (!res.ok) {
        throw new Error(
          body.message ?? body.error ?? `Delete failed (${res.status})`,
        );
      }
      await loadImages();
      toast.success("Brain image deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyRef(null);
    }
  }

  return (
    <PageShell
      title="Brain Images"
      icon={Brain}
      iconClassName="text-violet-400"
      subtitle="Saved Brain runtime images and the image currently running."
    >
      <div className="space-y-4">
        <Card className="border-white/[0.08] bg-white/[0.03]">
          <CardContent className="flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white">
                  Saved images
                </div>
                <div className="mt-1 text-xs text-white/50">
                  Run this image replaces the saved Brain machine image.
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadImages()}
                disabled={loading}
                className="gap-2 sm:self-start"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Refresh
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="min-w-0 rounded-md border border-white/[0.08] bg-black/20 p-3">
                <div className="text-[11px] font-semibold uppercase text-white/45">
                  Running Brain image
                </div>
                <div className="mt-1 truncate font-mono text-xs text-white">
                  {runningImageRef ? imageLabel(runningImageRef) : "None"}
                </div>
                <div className="mt-1 text-xs text-white/45">
                  {runningAt
                    ? `Applied ${formatDate(runningAt)}`
                    : runningImage
                      ? `Saved ${formatDate(runningImage.updatedAt)}`
                      : "Brain has no image"}
                </div>
                {machineImageRef && (
                  <div className="mt-2 truncate font-mono text-[11px] text-emerald-100/70">
                    Machine {machineState ?? "state unknown"} ·{" "}
                    {imageLabel(machineImageRef)}
                  </div>
                )}
              </div>
              <div className="min-w-0 rounded-md border border-white/[0.08] bg-black/20 p-3">
                <div className="text-[11px] font-semibold uppercase text-white/45">
                  Latest save
                </div>
                <div className="mt-1 truncate font-mono text-xs text-white">
                  {images[0] ? imageLabel(images[0].imageRef) : "None"}
                </div>
                <div className="mt-1 text-xs text-white/45">
                  {images[0]
                    ? `Saved ${formatDate(images[0].updatedAt)}`
                    : "No saved images yet"}
                </div>
              </div>
              <div className="min-w-0 rounded-md border border-white/[0.08] bg-black/20 p-3">
                <div className="text-[11px] font-semibold uppercase text-white/45">
                  Saved images
                </div>
                <div className="mt-1 truncate font-mono text-xs text-white">
                  {images.length === 1 ? "1 image" : `${images.length} images`}
                </div>
                <div className="mt-1 text-xs text-white/45">
                  {save?.status === "running"
                    ? `Saving ${imageTag(save.imageRef)}`
                    : save?.status === "failed"
                      ? "Last save failed"
                      : images.length > 0
                        ? "Newest first"
                        : "No saved images yet"}
                </div>
              </div>
            </div>
            {save?.status === "running" && (
              <div className="rounded-md border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-100">
                <div className="flex items-center gap-2 font-medium">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {phaseLabel(save)}
                </div>
                <div className="mt-1 text-amber-100/70">
                  {imageTag(save.imageRef)} · {elapsedLabel(save.startedAt)}
                  {liveSignalLabel(save.heartbeatAt)
                    ? ` · ${liveSignalLabel(save.heartbeatAt)}`
                    : ""}
                </div>
                {save.lastOutput && (
                  <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-black/25 p-2 font-mono text-[11px] text-amber-50/70">
                    {save.lastOutput}
                  </pre>
                )}
              </div>
            )}
            {runningNeedsMachineProof && (
              <div className="rounded-md border border-sky-400/20 bg-sky-400/[0.06] px-3 py-2 text-xs text-sky-100">
                Running image is recorded, but the live Fly machine image could
                not be verified from this page.
              </div>
            )}
            {save?.status === "failed" && (
              <div className="rounded-md border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2 text-xs text-rose-200">
                Last save failed: {save.error ?? save.jobId}
              </div>
            )}
            {applyState?.status === "running" && (
              <div
                className="rounded-md border border-violet-400/20 bg-violet-400/[0.06] px-3 py-2 text-xs text-violet-100"
                role="status"
                aria-live="polite"
              >
                <div className="flex items-center gap-2 font-medium">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Restoring Brain image
                </div>
                <div className="mt-1 text-violet-100/70">
                  {imageLabel(applyState.imageRef)} · {applyState.message ??
                    "The terminal will reconnect when the new machine is ready."}
                </div>
              </div>
            )}
            {applyState?.status === "failed" && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2 text-xs text-rose-200">
                <span>
                  Brain image restore failed: {applyState.error ?? "Try again."}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 border-rose-300/30 bg-transparent text-rose-100 hover:bg-rose-300/10"
                  onClick={() => requestApplyImage(applyState.imageRef)}
                >
                  Try again
                </Button>
              </div>
            )}
            <div className="sr-only">
              <div className="text-sm font-semibold text-white">
                Brain image state summary
              </div>
              <div>
                {runningImageRef
                  ? `Running Brain image ${imageLabel(runningImageRef)}`
                  : "No running Brain image"}
              </div>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}

        <div className="space-y-2">
          {loading && images.length === 0 ? (
            <div className="rounded-md border border-white/[0.08] bg-white/[0.03] px-4 py-8 text-center text-sm text-white/50">
              Loading Brain images...
            </div>
          ) : images.length === 0 ? (
            <div className="rounded-md border border-white/[0.08] bg-white/[0.03] px-4 py-8 text-center text-sm text-white/50">
              No Brain images saved yet.
            </div>
          ) : (
            images.map((image) => {
              const running = image.imageRef === runningImageRef;
              const busy = busyRef === image.imageRef;
              const applyBusy = applyState?.status === "running";
              return (
                <div
                  key={image.imageRef}
                  className="grid gap-3 rounded-md border border-white/[0.08] bg-white/[0.03] p-4 sm:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-mono text-sm text-white">
                        {imageLabel(image.imageRef)}
                      </span>
                      {running && (
                        <span
                          className="inline-flex shrink-0 items-center gap-1 rounded border border-emerald-400/20 bg-emerald-400/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300"
                          aria-label="Running Brain image"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          Running
                        </span>
                      )}
                    </div>
                    <div className="truncate font-mono text-xs text-white/35">
                      {image.imageRef}
                    </div>
                    <div className="text-xs text-white/45">
                      Saved {formatDate(image.updatedAt)}
                      {image.updatedAt !== image.createdAt
                        ? ` · Created ${formatDate(image.createdAt)}`
                        : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 sm:justify-end">
                    <Button
                      type="button"
                      size="icon"
                      variant={running ? "outline" : "default"}
                      disabled={busy || applyBusy}
                      title={running ? "Rerun Brain image" : "Run Brain image"}
                      aria-label={
                        running ? "Rerun Brain image" : "Run Brain image"
                      }
                      className={
                        running
                          ? "border-amber-400/35 bg-amber-400/10 text-amber-100 hover:bg-amber-400/15 hover:text-amber-50"
                          : undefined
                      }
                      onClick={() => requestApplyImage(image.imageRef)}
                    >
                      {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : running ? (
                        <RotateCcw className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      title="Open package"
                      aria-label="Open package"
                      onClick={() =>
                        window.open(
                          `https://${image.imageRef.split(":")[0]}`,
                          "_blank",
                        )
                      }
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      title={
                        running
                          ? "Run another image before deleting"
                          : "Delete image"
                      }
                      aria-label="Delete image"
                      disabled={busy || running || applyBusy}
                      onClick={() => setPendingDeleteRef(image.imageRef)}
                    >
                      {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      <ConfirmDialog
        open={pendingApplyRef !== null}
        title={
          pendingApplyIsRunning
            ? "Rerun this Brain image?"
            : "Run this Brain image?"
        }
        description={
          pendingApplyIsRunning && pendingApplyImage
            ? `This will rerun the active Brain image ${imageLabel(
                pendingApplyImage.imageRef,
              )}. Unsaved changes in the current machine may be lost unless saved as an image first.`
            : pendingApplyImage
              ? `This will replace the Brain machine image with ${imageLabel(
                  pendingApplyImage.imageRef,
                )}. Unsaved changes in the current machine may be lost unless saved as an image first.`
              : "This will replace the Brain machine image. Unsaved changes in the current machine may be lost unless saved as an image first."
        }
        confirmLabel={pendingApplyIsRunning ? "Rerun image" : "Run image"}
        onConfirm={() => {
          if (pendingApplyRef) {
            setPendingApplyRef(null);
            void applyImage(pendingApplyRef, pendingApplyIsRunning);
          }
        }}
        onClose={() => setPendingApplyRef(null)}
      />
      <ConfirmDialog
        open={pendingDeleteRef !== null}
        title="Permanently delete this Brain image?"
        description={
          pendingDeleteImage
            ? `This permanently removes the GHCR package image ${imageLabel(
                pendingDeleteImage.imageRef,
              )} and cannot be undone from Kody.`
            : "This permanently removes the GHCR package image and cannot be undone from Kody."
        }
        confirmLabel="Delete image"
        variant="destructive"
        onConfirm={() => {
          if (pendingDeleteRef) void deleteImage(pendingDeleteRef);
        }}
        onClose={() => setPendingDeleteRef(null)}
      />
    </PageShell>
  );
}

function restoreStageMessage(
  stage: NonNullable<
    NonNullable<BrainImagesResponse["runtime"]>["operation"]
  >["stage"],
  attempt?: number,
): string | undefined {
  const messages: Record<string, string> = {
    validating: "Validating restore",
    "resolving-image": "Finding saved image",
    "resolving-service": "Connecting to Brain infrastructure",
    provisioning: "Provisioning Brain",
    "installing-agent-access": "Installing secure agent access",
    "preparing-runtime-image": "Preparing Brain image",
    "verifying-health": "Verifying Brain health",
    "recording-runtime": "Finalizing Brain runtime",
    "recovering-previous": "Recovering previous Brain",
  };
  if (typeof stage !== "string") return undefined;
  const message = messages[stage];
  return message && attempt && attempt > 1
    ? `${message} (attempt ${attempt})`
    : message;
}
