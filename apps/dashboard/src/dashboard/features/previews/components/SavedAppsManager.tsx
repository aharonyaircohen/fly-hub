"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@kody-ade/base/ui/button";
import { Input } from "@kody-ade/base/ui/input";

type SavedApp = {
  id: string;
  name: string;
  sourceApp: string;
  createdAt: string;
  imageRef: string;
};
type Job = {
  jobId: string;
  workerApp: string;
  action: "save" | "create";
  status: "working" | "completed" | "failed";
  phase: string;
  name: string;
  error: string | null;
  appName: string | null;
  url: string | null;
  imageRef: string;
  createdAt: string;
  updatedAt: string;
};
export type SaveAppRequest = { app: string; nonce: number };
async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    ...(body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error || `Request failed (HTTP ${response.status}).`,
    );
  return result as T;
}
const phaseNames: Record<string, string> = {
  starting: "Starting",
  "preparing-gateway": "Preparing password gateway",
  "preparing-runtime": "Preparing app files and settings",
  "copying-gateway-files": "Copying password gateway",
  "copying-runtime-files": "Copying app files and data",
  "uploading-to-ghcr": "Uploading encrypted app to GHCR",
  saved: "Saved",
  "downloading-saved-app": "Downloading saved app",
  "restoring-runtime-files": "Restoring app files and data",
  "restoring-gateway-files": "Restoring password gateway",
  "checking-restored-app": "Checking app startup and password access",
  "cleaning-up-failed-create": "Removing incomplete app",
  created: "Created",
};
export function SavedAppsManager({
  saveRequest,
}: {
  saveRequest: SaveAppRequest | null;
}) {
  const [user, setUser] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState<SavedApp[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [createId, setCreateId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const handled = useRef<number | null>(null);
  const savedSection = useRef<HTMLElement | null>(null);
  async function load() {
    const data = await request<{ saved: SavedApp[]; jobs: Job[] }>(
      "/api/fly-hub/apps/saved",
    );
    setSaved(data.saved);
    setJobs((current) => {
      const byId = new Map(current.map((job) => [job.jobId, job]));
      for (const job of data.jobs) {
        const existing = byId.get(job.jobId);
        if (!existing || existing.updatedAt <= job.updatedAt)
          byId.set(job.jobId, job);
      }
      return [...byId.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 10);
    });
    setError("");
  }
  useEffect(() => {
    let active = true;
    request<{ user: string | null }>("/api/fly-hub/registry")
      .then((data) => {
        if (active) setUser(data.user);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (user) void load().catch((cause) => setError(cause.message));
  }, [user]);
  useEffect(() => {
    if (!saveRequest || handled.current === saveRequest.nonce) return;
    savedSection.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    if (!user) {
      setError(
        "Connect GitHub below to save this app. Your save will start after connecting.",
      );
      return;
    }
    handled.current = saveRequest.nonce;
    setError("");
    setBusy(true);
    request<{ job: Job }>("/api/fly-hub/apps/saved", {
      action: "save",
      app: saveRequest.app,
    })
      .then(({ job }) => setJobs((current) => [job, ...current]))
      .catch((cause) => setError(cause.message))
      .finally(() => setBusy(false));
  }, [saveRequest, user]);
  const activeJobs = jobs.filter((job) => job.status === "working");
  const activeKey = activeJobs.map((j) => j.jobId).join(",");
  useEffect(() => {
    if (!activeKey) return;
    let active = true,
      polling = false;
    async function poll() {
      if (polling) return;
      polling = true;
      try {
        const updated = await Promise.all(
          activeKey
            .split(",")
            .map((id) =>
              request<{ job: Job }>(
                `/api/fly-hub/apps/saved?job=${encodeURIComponent(id)}`,
              ).then((r) => r.job),
            ),
        );
        if (!active) return;
        setError("");
        setJobs((current) =>
          current.map(
            (job) => updated.find((j) => j.jobId === job.jobId) ?? job,
          ),
        );
        if (
          updated.some(
            (job) => job.status === "completed" && job.action === "save",
          )
        ) {
          const data = await request<{ saved: SavedApp[] }>(
            "/api/fly-hub/apps/saved",
          );
          if (active) setSaved(data.saved);
        }
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not check saved app progress.",
          );
      } finally {
        polling = false;
      }
    }
    const timer = window.setInterval(() => void poll(), 4000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [activeKey]);
  async function connect() {
    setBusy(true);
    setError("");
    try {
      const result = await request<{ user: string }>("/api/fly-hub/registry", {
        token,
      });
      setUser(result.user);
      setToken("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not connect GitHub.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (!createId) return;
    setBusy(true);
    setError("");
    try {
      const result = await request<{ job: Job }>("/api/fly-hub/apps/saved", {
        action: "create",
        id: createId,
        name,
      });
      setJobs((current) => [result.job, ...current]);
      setCreateId(null);
      setName("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not create app.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      ref={savedSection}
      className="space-y-3"
      aria-labelledby="saved-apps-title"
    >
      <h2 id="saved-apps-title" className="text-lg font-semibold">
        Saved apps
      </h2>
      <p className="text-sm text-muted-foreground">
        Save the current app files, settings, credentials, and data to private
        GitHub Container Registry. The app pauses while its files are copied. A
        saved app starts again when restored.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!user ? (
        <form
          className="space-y-2 rounded-xl border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          <p className="text-sm">
            Connect your GitHub account with a classic token that has{" "}
            <code>write:packages</code> permission. The token is stored
            encrypted.
          </p>
          <a
            className="text-sm underline"
            href="https://github.com/settings/tokens/new?scopes=write:packages&description=FlyHub%20saved%20apps"
            target="_blank"
            rel="noopener noreferrer"
          >
            Create GitHub token
          </a>
          <label htmlFor="saved-app-github-token" className="block text-sm">
            GitHub token
          </label>
          <Input
            id="saved-app-github-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
          />
          <Button type="submit" disabled={busy || !token}>
            {busy ? "Connecting…" : "Connect GitHub"}
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>
            Saving privately to{" "}
            <code>ghcr.io/{user.toLowerCase()}/flyhub-saved-apps</code>
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void load().catch((cause) => setError(cause.message))
            }
          >
            Refresh saved apps
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || activeJobs.length > 0}
            onClick={() =>
              void fetch("/api/fly-hub/registry", { method: "DELETE" })
                .then((response) => {
                  if (!response.ok)
                    throw new Error("Could not disconnect GitHub.");
                  setUser(null);
                  setSaved([]);
                  setJobs([]);
                })
                .catch((cause) => setError(cause.message))
            }
          >
            Disconnect GitHub
          </Button>
        </div>
      )}
      {jobs.slice(0, 5).map((job) => (
        <div
          key={job.jobId}
          role="status"
          className="rounded-xl border p-4 text-sm space-y-1"
        >
          <strong>
            {job.action === "save" ? "Saving" : "Creating"} {job.name}
          </strong>
          <p>
            {job.status === "failed"
              ? "Failed"
              : phaseNames[job.phase] || job.phase.replaceAll("-", " ")}
          </p>
          {job.error && (
            <p className="text-destructive">
              {job.action === "save" ? "Save" : "Create"} failed during{" "}
              {phaseNames[job.phase]?.toLowerCase() ||
                job.phase.replaceAll("-", " ")}
              . Open Job details for the error.
            </p>
          )}
          {job.status === "completed" && job.action === "create" && job.url && (
            <p>
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Open created app
              </a>
              . Its password is available under Deployed apps → Show password.
            </p>
          )}
          <details>
            <summary className="cursor-pointer text-muted-foreground">
              Job details
            </summary>
            <p>Job: {job.jobId}</p>
            <p>Image: {job.imageRef}</p>
            <p>Started: {new Date(job.createdAt).toLocaleString()}</p>
            <p>Last update: {new Date(job.updatedAt).toLocaleString()}</p>
            {job.error && (
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-destructive">
                {job.error}
              </pre>
            )}
            <a
              href={`https://fly.io/apps/${encodeURIComponent(job.workerApp)}/machines/${encodeURIComponent(job.jobId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Open worker in Fly
            </a>
          </details>
        </div>
      ))}
      {user && saved.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No saved apps yet. Use Save app on a deployed app above.
        </p>
      )}
      {saved.map((app) => (
        <div
          key={app.id}
          className="rounded-xl border bg-card p-4 text-sm space-y-2"
        >
          <div className="flex flex-wrap justify-between gap-2">
            <strong>{app.name}</strong>
            <span>{new Date(app.createdAt).toLocaleString()}</span>
          </div>
          <p className="text-muted-foreground break-all">{app.imageRef}</p>
          {createId === app.id ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <label htmlFor={`saved-app-name-${app.id}`} className="block">
                New app name
              </label>
              <Input
                id={`saved-app-name-${app.id}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                required
              />
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || !name.trim()}>
                  Create app
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCreateId(null)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={busy || activeJobs.length > 0}
              onClick={() => {
                setCreateId(app.id);
                setName(`${app.name} copy`.slice(0, 80));
              }}
            >
              Create from saved app
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}
